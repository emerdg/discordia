# Discórdia — Compartilhe sua tela, sem depender de servidores

Compartilhamento de tela em **grupo**, 100% **P2P via WebRTC** para **2 a 10 pessoas**.

O vídeo sai do seu PC direto para as telas dos participantes — **nenhum conteúdo
(mídia ou chat) passa por servidor**. O **Firebase** é usado apenas como *hub*:
localizar salas, presença e a **sinalização** inicial do WebRTC (troca de
offer/answer/ICE). Todo o resto é trocado entre os navegadores.

A captura usa o pipeline de captura do sistema (`getDisplayMedia`) e a
codificação é feita pelo **encoder de hardware** da sua placa de vídeo quando
disponível:

- **NVIDIA** → NVENC
- **Intel** → Quick Sync
- **AMD** → VCN / AMF
- **Apple** → VideoToolbox

Para conferir qual encoder foi usado, abra `chrome://media-internals` e procure
o evento de *Encoder* do fluxo da sala.

## Como funciona

```
[Participante A] ──WebRTC P2P──▶ [Participante B]
     │                                 ▲
     └──────── WebRTC P2P ─────────────┘
              (malha completa)
       ▲                               │
       └──────────────┐   ┌────────────┘
                      ▼   ▼
        [Participante C, D, ...]  (todos conectam entre si)

[Firebase RTDB] = só presença + sinalização (nenhuma mídia/chat)
```

- **Malha completa**: cada usuário conecta um *data channel* com todos os outros
  (chat, hello, pedido de metadados da sala).
- **Mídia sob demanda**: a conexão de mídia só é aberta quando você clica em
  alguém para assistir. O encoder de hardware só roda enquanto há espectador.
- **Transmitir e assistir ao mesmo tempo**: são conexões independentes.
- **Prévia própria** em miniatura (pausada) acima do chat — continua transmitindo
  sem gastar renderização de vídeo local.

## O que fica onde

| Dado                                    | Onde é guardado                          |
|-----------------------------------------|------------------------------------------|
| Nome, emoji, cor, preferências          | `localStorage` do navegador              |
| Histórico de salas acessadas            | `localStorage` do navegador              |
| Mensagens do chat (limite configurável) | `IndexedDB` do navegador                 |
| Metadados da sala (nome, limite)        | Firebase RTDB (só para achar a sala)     |
| Presença / quem está transmitindo       | Firebase RTDB (presença)                 |
| Sinalização WebRTC (offer/answer/ICE)   | Firebase RTDB (descartável, por conexão) |
| Mídia e chat (conteúdo)                 | 100% P2P — não passa por servidor        |

## Telas

1. **Início** — apresentação, link do GitHub e campo de nome (salvo localmente).
2. **Página do usuário** — criar sala (nome + limite 2–10, com aviso acima de 5),
   entrar por ID, histórico de salas (com exclusão) e configurações:
   limite do histórico do chat (não salvar/25/50/100), lado do chat
   (esquerda/direita), cor do nome (5 sugestões + personalizada) e emoji (50).
3. **Sala** — participantes no topo (emoji + nome colorido + indicador 🔴 de
   quem está transmitindo; clique para assistir), chat lateral, botão de
   transmitir com opções (**microfone**, **áudio do PC** e **resolução**
   1080/720/480), miniatura da própria transmissão, **tela cheia real** com
   overlay que se oculta sozinho, copiar ID e sair.

O chat fica salvo localmente: ao reentrar na sala, carregam as **últimas 5
mensagens** e um botão **"ver mais"** busca as mais antigas.

### Recursos do chat

- **Pesquisa de emojis** no seletor (busca por categoria ou nome, ex.: "gato").
- **Filtro de linguagem** (padrão ativado): censura ofensas e racismo no envio e
  na exibição — pode ser desativado em Configurações.
- **Filtro de spam**: no máximo 1 mensagem a cada 10 segundos.
- **Links clicáveis**: `http(s)://...` aparecem como links no chat.

### Personalização

- **8 temas** de cores: Discórdia (padrão), NVIDIA, AMD e Intel, cada um em
  versões **claro** e **escuro**.
- **Responsivo**: em telas pequenas o chat vira um painel lateral que abre e
  fecha pelo botão de chat; o restante do layout se adapta ao celular.

## Como usar

1. Abra `https://mostrapraeu.web.app` (ou rode localmente, abaixo).
2. Digite seu nome e entre.
3. **Criar sala**: informe o nome e o limite de pessoas. Compartilhe o **ID**.
4. **Entrar**: informe o ID (o nome da sala é sincronizado com os demais).
5. Na sala: clique em **📡 Transmitir**, ajuste microfone/áudio/resolução e
   inicie. Clique no nome de quem está com 🔴 para assistir.

> Dica: quem cria a sala deve deixar a aba aberta para receber os demais;
> depois que todos estão conectados, a malha P2P não depende de ninguém.

## Desenvolver localmente

```bash
npm install
cp .env.example .env.local   # preencha com os dados do seu Firebase
npm run dev                  # http://localhost:5173
```

Para testar em duas janelas: abra `http://localhost:5173` em duas abas
(normal + janela anônima).

## Build e deploy

```bash
npm run build
npm run build:testes        # build paralelo para https://.../testes (preview)
npx firebase deploy          # hosting + database rules
```

As regras do Realtime Database estão em `database.rules.json` (acesso somente
ao caminho `/rooms`; o restante do banco é bloqueado).

## Compatibilidade entre navegadores

O vídeo usa WebRTC P2P. Por padrão o app negocia **VP8** (o codec mais
universal entre Chrome/Edge/Firefox/Safari e sistemas). Quem quiser priorizar
aceleração de hardware (NVENC/Quick Sync/VCN) pode trocar em **Configurações →
Codec de vídeo → H.264 · Hardware**. Nas configurações o painel **🛠** mostra o
codec negociado e o estado da conexão de mídia.

## Configuração (variáveis de ambiente)

| Variável                           | Descrição                                  |
|------------------------------------|--------------------------------------------|
| `VITE_FIREBASE_API_KEY`            | Chave de API do app web                    |
| `VITE_FIREBASE_AUTH_DOMAIN`        | Ex.: `projeto.firebaseapp.com`             |
| `VITE_FIREBASE_DATABASE_URL`       | URL do Realtime Database                   |
| `VITE_FIREBASE_PROJECT_ID`         | ID do projeto                              |
| `VITE_FIREBASE_STORAGE_BUCKET`     | Bucket de storage (não usado)              |
| `VITE_FIREBASE_MESSAGING_SENDER_ID`| Sender ID                                  |
| `VITE_FIREBASE_APP_ID`             | App ID                                     |
| `VITE_GITHUB_URL`                  | Link do repositório na página inicial      |

## Limitações honestas

- **Malha P2P**: com muitos participantes transmitindo ao mesmo tempo, o
  upload de cada um e o download dos espectadores sobem rápido. O app avisa
  acima de 5 pessoas; acima disso considere assistir apenas quem importa.
- **NAT restritivo**: casos raros de NAT simétrico (VPN/corporativo) podem
  precisar de um servidor **TURN**. Por padrão usa STUN público.
- **`getDisplayMedia`** é limitado no iOS/móvel.
- **Sem autenticação**: quem tiver o ID da sala participa.

## Roteiro (ideias futuras)

- Codecs E2E no banco (proteção contra escrita acidental/abuso).
- `video.requestVideoFrameCallback` na prévia para economia extra.
- Suporte a seleção de janela/aba específica na captura.
