// --- Deck de syllabes (poids = nombre d'exemplaires dans la pioche) ---
// Syllabes courtes et courantes en plus grand nombre, sons/finales plus rares en moins d'exemplaires.
export const SYLLABLE_WEIGHTS = [
  ['BA', 6], ['BE', 6], ['BI', 5], ['BO', 5], ['BU', 4],
  ['CA', 6], ['CE', 6], ['CHA', 5], ['CHE', 5], ['CI', 5], ['CO', 6], ['CU', 4],
  ['DA', 6], ['DE', 7], ['DI', 5], ['DO', 5], ['DU', 4],
  ['FA', 5], ['FE', 5], ['FI', 5], ['FO', 4], ['GA', 4], ['GE', 4],
  ['HI', 3], ['JA', 4], ['JE', 4], ['JO', 3],
  ['LA', 7], ['LE', 7], ['LI', 6], ['LO', 5], ['LU', 4],
  ['MA', 6], ['ME', 6], ['MI', 6], ['MO', 5], ['MU', 4],
  ['NA', 5], ['NE', 6], ['NI', 5], ['NO', 5], ['NU', 3],
  ['PA', 6], ['PE', 6], ['PI', 5], ['PO', 5], ['PU', 3],
  ['RA', 6], ['RE', 8], ['RI', 6], ['RO', 5], ['RU', 3],
  ['SA', 6], ['SE', 6], ['SI', 6], ['SO', 5], ['SU', 4],
  ['TA', 6], ['TE', 6], ['TI', 6], ['TO', 5], ['TU', 4],
  ['VA', 5], ['VE', 5], ['VI', 5], ['VO', 4],
  ['BLE', 3], ['BRE', 3], ['CLE', 3], ['CRE', 2], ['DRE', 3],
  ['FRE', 2], ['GRE', 2], ['PLE', 2], ['PRE', 3], ['TRE', 3],
  ['TION', 4], ['MENT', 4], ['ISME', 2], ['ETTE', 3], ['ELLE', 3],
  ['IQUE', 3], ['ABLE', 2], ['IBLE', 2], ['ANT', 4], ['ENT', 4],
  ['OIR', 3], ['AGE', 3], ['URE', 3], ['EUR', 4], ['TÉ', 3],
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
