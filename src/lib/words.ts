/**
 * Filtro de linguagem: censura palavras ofensivas e racistas (PT-BR + EN).
 * Aplica-se no envio e na exibição das mensagens, e pode ser desativado.
 */

const WORDS: string[] = [
  // PT-BR — xingamentos e palavrões
  'caralho', 'porra', 'merda', 'bosta', 'foda', 'fudeu', 'fodase', 'foda-se',
  'buceta', 'bucetinha', 'cu', 'rola', 'pau', 'pica', 'pinto', 'piroca',
  'puta', 'putaria', 'prostituta', 'vadia', 'vagabunda', 'vagabundo',
  'viado', 'bicha', 'baitola', 'boiola', 'sapatão', 'veado',
  'otario', 'otária', 'babaca', 'idiota', 'imbecil', 'burro', 'burra',
  'arrombado', 'arrombada', 'corno', 'cuck', 'palhaço', 'palhacada',
  'cacete', 'cacetada', 'desgraçado', 'desgraçada', 'demônio', 'inferno',
  'maldito', 'maldita', 'anormal', 'aberração', 'nojento', 'nojenta',
  'lixo', 'lixoso', 'escroto', 'escrota', 'fdp', 'pnc', 'vsf',
  'fuder', 'fudendo', 'fudido', 'fudida', 'chupa', 'chupa minhoca',
  'tomar no cu', 'vai tomar no cu', 'filho da puta', 'filha da puta',
  'puta que pariu', 'vai se fuder', 'vai se foder', 'vtnc', 'tnc',
  // Racismo
  'crioulo', 'crioula', 'macaco', 'macaquinho', 'neguinho', 'neguinha',
  'moleque', 'safado', 'pretinha', 'pretinho', 'mucama', 'sinhozinho',
  'judeu', 'judia', 'japa', 'cambada', 'canibal', 'selvagem',
  // EN
  'shit', 'fuck', 'fucking', 'motherfucker', 'fucker', 'asshole',
  'bitch', 'bastard', 'cunt', 'dick', 'pussy', 'whore', 'slut',
  'nigga', 'nigger', 'faggot', 'fag', 'retard', 'retarded', 'moron',
  'idiot', 'dumbass', 'douchebag', 'son of a bitch', 'jackass', 'piss off',
  'wanker', 'bugger', 'bullshit', 'cocksucker', 'twat', 'bollocks',
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