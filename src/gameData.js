// --- Deck de lettres (poids = nombre d'exemplaires dans la pioche) ---
// Distribution inspirée du Scrabble français : voyelles et lettres
// fréquentes en grand nombre, lettres rares en un seul exemplaire.
export const SYLLABLE_WEIGHTS = [
  ['E', 15], ['A', 9], ['I', 8], ['O', 6], ['U', 6],
  ['N', 6], ['R', 6], ['S', 6], ['T', 6], ['L', 5],
  ['D', 3], ['M', 3], ['C', 3],
  ['G', 2], ['B', 2], ['P', 2], ['F', 2], ['H', 2], ['V', 2],
  ['J', 1], ['Q', 1], ['K', 1], ['W', 1], ['X', 1], ['Y', 1], ['Z', 1],
]

export function buildDeck() {
  const deck = []
  let id = 0
  for (const [syllable, count] of SYLLABLE_WEIGHTS) {
    for (let i = 0; i < count; i++) {
      deck.push({ id: `c${id++}`, syllable })
    }
  }
  // Mélange (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

// Chaque joueur démarre avec les 26 lettres de l'alphabet, une seule fois chacune.
// Les voyelles valent plus de points au départ (multiplicateur), mais ce
// multiplicateur diminue à chaque fois que la lettre est jouée par quelqu'un,
// jusqu'à un plancher de x1. Les consonnes valent toujours 1 point.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
export const VOWELS = ['A', 'E', 'I', 'O', 'U', 'Y']
export const VOWEL_START_MULT = 3

export function buildAlphabetHand() {
  return ALPHABET.map((letter) => ({
    id: `l${letter}${Math.random().toString(36).slice(2, 6)}`,
    syllable: letter,
  }))
}

export function initialMultipliers() {
  return Object.fromEntries(VOWELS.map((v) => [v, VOWEL_START_MULT]))
}

export function letterValue(letter, multipliers) {
  if (!VOWELS.includes(letter)) return 1
  return multipliers?.[letter] ?? VOWEL_START_MULT
}

// --- Normalisation (on ignore les accents pour la comparaison, pas pour l'affichage) ---
export function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// --- Trie pour validation rapide préfixe / mot complet ---
class TrieNode {
  constructor() {
    this.children = new Map()
    this.isWord = false
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode()
  }
  insert(word) {
    let node = this.root
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode())
      node = node.children.get(ch)
    }
    node.isWord = true
  }
  // Existe-t-il au moins un mot qui commence par ce préfixe ?
  hasPrefix(prefix) {
    let node = this.root
    for (const ch of prefix) {
      if (!node.children.has(ch)) return false
      node = node.children.get(ch)
    }
    return true
  }
  // Le préfixe est-il lui-même un mot complet valide ?
  isWord(word) {
    let node = this.root
    for (const ch of word) {
      if (!node.children.has(ch)) return false
      node = node.children.get(ch)
    }
    return node.isWord
  }
}

const DICTIONARY_URL =
  'https://raw.githubusercontent.com/words/an-array-of-french-words/master/index.json'
const CACHE_KEY = 'syllabo_fr_trie_wordlist_v1'

let triePromise = null

// Charge le dico (avec cache localStorage) et construit le Trie une seule fois.
export function loadTrie(onProgress) {
  if (triePromise) return triePromise

  triePromise = (async () => {
    let words
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) {
        words = JSON.parse(cached)
      }
    } catch (e) {
      // cache corrompu ou trop gros pour localStorage, on ignore
    }

    if (!words) {
      onProgress?.('Téléchargement du dictionnaire…')
      const res = await fetch(DICTIONARY_URL)
      words = await res.json()
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(words))
      } catch (e) {
        // trop volumineux pour localStorage sur certains navigateurs, tant pis
      }
    }

    onProgress?.('Construction du dictionnaire…')
    const trie = new Trie()
    for (const w of words) {
      const clean = normalize(w)
      // on ignore les mots avec espaces/apostrophes/tirets pour rester simple
      if (/^[a-z]+$/.test(clean)) trie.insert(clean)
    }
    return trie
  })()

  return triePromise
}
