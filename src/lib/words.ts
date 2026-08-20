/*
 * Filtro de linguagem: censura palavras ofensivas, racistas e discriminatórias (PT-BR + EN).
 * Edite a lista WORDS abaixo; o padrão é recompilado no build.
 */

const WORDS: string[] = [
  // PT-BR — xingamentos e palavrões
  'caralho', 'porra', 'merda', 'bosta', 'foda', 'fudeu', 'fodase' ,
  'foda-se', 'buceta', 'bucetinha', 'cu', 'rola', 'pau', 'pica' ,
  'pinto', 'piroca', 'puta', 'putaria', 'prostituta', 'vadia', 'vagabunda' ,
  'vagabundo', 'viado', 'bicha', 'baitola', 'boiola', 'sapatão', 'veado' ,
  'otario', 'otária', 'babaca', 'idiota', 'imbecil', 'burro', 'burra' ,
  'arrombado', 'arrombada', 'corno', 'cuck', 'palhaço', 'palhacada', 'cacete' ,
  'cacetada', 'desgraçado', 'desgraçada', 'demônio', 'inferno', 'maldito', 'maldita' ,
  'anormal', 'aberração', 'nojento', 'nojenta', 'lixo', 'lixoso', 'escroto' ,
  'escrota', 'fdp', 'pnc', 'vsf', 'fuder', 'fudendo', 'fudido' ,
  'fudida', 'chupa', 'chupa minhoca', 'tomar no cu', 'vai tomar no cu', 'filho da puta', 'filha da puta' ,
  'puta que pariu', 'vai se fuder', 'vai se foder', 'vtnc', 'tnc' ,
  // Racismo e discriminação (PT-BR)
  'crioulo', 'crioula', 'macaco', 'macaquinho', 'neguinho', 'neguinha', 'moleque' ,
  'safado', 'pretinha', 'pretinho', 'mucama', 'sinhozinho', 'judeu', 'judia' ,
  'japa', 'cambada', 'canibal', 'selvagem' ,
  // EN — profanity e slurs
  'shit', 'fuck', 'fucking', 'motherfucker', 'fucker', 'asshole', 'bitch' ,
  'bastard', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'nigga' ,
  'nigger', 'faggot', 'fag', 'retard', 'retarded', 'moron', 'idiot' ,
  'dumbass', 'douchebag', 'son of a bitch', 'jackass', 'piss off', 'wanker', 'bugger' ,
  'bullshit', 'cocksucker', 'twat', 'bollocks' ,
  // PT-BR — variantes, plurais e gírias
  'caralhos', 'porras', 'merdas', 'bostas', 'fodeu', 'foder', 'fudidos' ,
  'fudidas', 'bucetas', 'cus', 'rolas', 'paus', 'picas', 'pintos' ,
  'pirocas', 'putas', 'prostituto', 'vadias', 'vagabundos', 'otaria', 'otário' ,
  'otarios', 'otarias', 'babacas', 'idiotas', 'imbecis', 'corna', 'cornos', 'demonio' ,
  'aberracao', 'piranha', 'piranhas', 'pustula', 'suruba', 'punheta', 'punheteiro' ,
  'siririca', 'pica-pau', 'k9', 'k2' ,
  // EN — profanity (variantes)
  'shitting', 'shitty', 'fucked', 'bitches', 'cunts', 'dicks', 'whores' ,
  'sluts', 'crap', 'dipshit', 'prick' ,
  // Racismo/discriminação (slurs PT-BR + EN)
  'tiro ao negro', 'servico de preto', 'trabalho de preto', 'chapa amarela', 'n1gg3r', 'n1gg4', 'kike' ,
  'kyke', 'chink', 'spic', 'gook', 'wetback', 'negro de merda', 'preto de merda' ,
  'ciganagem', 'judeu de merda' ,
  // Homofobia e transfobia
  'viadinho', 'bichinha', 'sapatona', 'traveco', 'travequinha', 'gayzista', 'mafia gay' ,
  'sodomita', 'tranny', 'dyke', 'homossexualismo', 'queer de merda', 'chupa rola' ,
  // Misoginia
  'feminazi', 'incel', 'femcel', 'misogino', 'misoginia', 'machista', 'vadiazinha' ,
  'mulherzinha', 'putinha', 'vadia do caralho', 'depositario', 'lavadora de louça', 'cozinha e lugar de mulher' ,
  // Extremismo e neonazismo
  'nazi', 'nazista', 'nazismo', 'hitler', 'adolf hitler', 'heil hitler', 'sieg heil' ,
  'swastika', 'esvastica', '1488', 'fourteen words', 'white power', 'supremacia branca', 'supremacista' ,
  'ku klux klan', 'kkk', 'neonazi', 'neonazista', 'holocausto fake', 'aryan', 'ariano' ,
  'puro sangue', 'ss officer' ,
  // Conteúdo sexual explícito
  'estupro', 'estuprador', 'estuprar', 'pedofilo', 'pedofilia', 'hentai', 'porn' ,
  'porno', 'pornografia', 'zoofilia', 'necrofilia', 'sexo explícito', 'boquete', 'cumshot' ,
  'gangbang', 'deepthroat'
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PATTERN = new RegExp(`\\b(${WORDS.map(escapeRegExp).join('|')})\\b`, 'giu');

/** Verifica se o texto contém algum termo do filtro. */
export function hasOffensive(text: string): boolean {
  PATTERN.lastIndex = 0;
  return PATTERN.test(text);
}

/** Substitui termos ofensivos mantendo a primeira letra (ex.: "p*rra"). */
export function censorText(text: string): string {
  return text.replace(PATTERN, (m) => (m.length <= 1 ? m : m[0] + '*'.repeat(m.length - 1)));
}
