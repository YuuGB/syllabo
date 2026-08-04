import React, { useEffect, useMemo, useRef, useState } from 'react'
import { db } from './firebase'
import {
  ref, push, set, update, onValue, runTransaction, serverTimestamp,
} from 'firebase/database'
import { buildDeck, loadTrie, normalize } from './gameData'

const HAND_SIZE = 10
const WORD_TIMEOUT_MS = 30000

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function getOrCreatePlayerId() {
  let id = localStorage.getItem('syllabo_player_id')
  if (!id) {
    id = 'p' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem('syllabo_player_id', id)
  }
  return id
}

export default function App() {
  const [trie, setTrie] = useState(null)
  const [loadingMsg, setLoadingMsg] = useState('Chargement du dictionnaire…')
  const [screen, setScreen] = useState('home') // home | lobby | game
  const [name, setName] = useState(localStorage.getItem('syllabo_name') || '')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [room, setRoom] = useState(null)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [flash, setFlash] = useState(null) // { type: 'error'|'ok', text }
  const [, forceTick] = useState(0)

  const playerId = useMemo(getOrCreatePlayerId, [])

  useEffect(() => {
    loadTrie(setLoadingMsg).then(setTrie)
  }, [])

  // Tick pour rafraîchir les barres de timer chaque seconde
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Abonnement à la room
  useEffect(() => {
    if (!roomCode) return
    const roomRef = ref(db, `rooms/${roomCode}`)
    const unsub = onValue(roomRef, (snap) => {
      const val = snap.val()
      setRoom(val)
      if (val) setScreen(val.status === 'playing' || val.status === 'finished' ? 'game' : 'lobby')
    })
    return () => unsub()
  }, [roomCode])

  // Fermeture automatique des mots dont le timer est écoulé (n'importe quel client peut le déclencher)
  useEffect(() => {
    if (!room || room.status !== 'playing') return
    const table = room.table || {}
    Object.entries(table).forEach(([wordId, w]) => {
      if (!w.closed && Date.now() - w.lastMoveTs > WORD_TIMEOUT_MS) {
        const wordRef = ref(db, `rooms/${roomCode}/table/${wordId}`)
        runTransaction(wordRef, (cur) => {
          if (!cur || cur.closed) return cur
          return { ...cur, closed: true }
        })
      }
    })
  }, [room, roomCode])

  function showFlash(type, text) {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 1800)
  }

  async function createRoom() {
    if (!name.trim()) return showFlash('error', 'Entre ton prénom')
    localStorage.setItem('syllabo_name', name)
    const code = randomCode()
    await set(ref(db, `rooms/${code}`), {
      status: 'lobby',
      hostId: playerId,
      createdAt: Date.now(),
      players: { [playerId]: { name, hand: [] } },
      table: {},
    })
    setRoomCode(code)
  }

  async function joinRoom() {
    if (!name.trim()) return showFlash('error', 'Entre ton prénom')
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    localStorage.setItem('syllabo_name', name)
    await update(ref(db, `rooms/${code}/players/${playerId}`), { name, hand: [] })
    setRoomCode(code)
  }

  async function startGame() {
    const playerIds = Object.keys(room.players || {})
    if (playerIds.length < 2) return showFlash('error', 'Il faut au moins 2 joueurs')
    const deck = buildDeck()
    const updates = { status: 'playing' }
    playerIds.forEach((pid, i) => {
      updates[`players/${pid}/hand`] = deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE)
    })
    await update(ref(db, `rooms/${roomCode}`), updates)
  }

  // Tente de poser la carte sélectionnée sur un mot existant (wordId) ou d'en démarrer un nouveau (wordId = null)
  async function playCard(wordId) {
    if (!selectedCardId || !room) return
    const me = room.players[playerId]
    const card = (me.hand || []).find((c) => c.id === selectedCardId)
    if (!card) return

    if (wordId === null) {
      const candidate = normalize(card.syllable)
      if (!trie.hasPrefix(candidate)) {
        showFlash('error', `"${card.syllable}" ne peut démarrer aucun mot`)
        return
      }
      const newWordRef = push(ref(db, `rooms/${roomCode}/table`))
      await set(newWordRef, {
        letters: [{ syllable: card.syllable, playerId, playerName: me.name }],
        lastPlayerId: playerId,
        lastMoveTs: Date.now(),
        closed: false,
      })
      await removeCardFromHand(card.id)
      setSelectedCardId(null)
      return
    }

    const word = room.table[wordId]
    if (word.closed || Date.now() - word.lastMoveTs > WORD_TIMEOUT_MS) {
      showFlash('error', 'Ce mot est déjà clos')
      return
    }
    if (word.lastPlayerId === playerId) {
      showFlash('error', 'Attends qu\u2019un autre joueur contribue avant de rejouer ici')
      return
    }
    const current = word.letters.map((l) => l.syllable).join('')
    const candidate = normalize(current + card.syllable)
    if (!trie.hasPrefix(candidate)) {
      showFlash('error', `"${current}${card.syllable}" ne mène à aucun mot`)
      return
    }

    const wordRef = ref(db, `rooms/${roomCode}/table/${wordId}`)
    const result = await runTransaction(wordRef, (cur) => {
      if (!cur || cur.closed) return cur
      if (Date.now() - cur.lastMoveTs > WORD_TIMEOUT_MS) return cur
      if (cur.lastPlayerId === playerId) return cur // abort silencieux (contrôlé aussi côté serveur)
      return {
        ...cur,
        letters: [...cur.letters, { syllable: card.syllable, playerId, playerName: me.name }],
        lastPlayerId: playerId,
        lastMoveTs: Date.now(),
      }
    })

    if (!result.committed || result.snapshot.val()?.lastPlayerId !== playerId ||
        result.snapshot.val()?.letters.length !== word.letters.length + 1) {
      showFlash('error', 'Coup refusé (quelqu\u2019un vous a devancé ou double-pose interdite)')
      return
    }

    await removeCardFromHand(card.id)
    setSelectedCardId(null)
  }

  async function removeCardFromHand(cardId) {
    const handRef = ref(db, `rooms/${roomCode}/players/${playerId}/hand`)
    await runTransaction(handRef, (hand) => (hand || []).filter((c) => c.id !== cardId))
  }

  // --- Rendu ---

  if (!trie) {
    return <div className="center-screen"><div className="loader" /><p>{loadingMsg}</p></div>
  }

  if (screen === 'home') {
    return (
      <div className="center-screen">
        <h1 className="logo">Syllabo</h1>
        <p className="tagline">Construisez des mots à plusieurs, syllabe par syllabe.</p>
        <input
          className="input" placeholder="Ton prénom" value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" onClick={createRoom}>Créer une partie</button>
        <div className="divider">ou</div>
        <input
          className="input" placeholder="Code de la partie" value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={4}
        />
        <button className="btn" onClick={joinRoom}>Rejoindre</button>
      </div>
    )
  }

  if (!room) return <div className="center-screen"><p>Connexion…</p></div>

  if (screen === 'lobby') {
    const players = Object.entries(room.players || {})
    return (
      <div className="center-screen">
        <h2>Salon <span className="code">{roomCode}</span></h2>
        <p className="tagline">Partage ce code pour inviter d'autres joueurs.</p>
        <ul className="player-list">
          {players.map(([id, p]) => <li key={id}>{p.name}{id === room.hostId && ' (hôte)'}</li>)}
        </ul>
        {room.hostId === playerId ? (
          <button className="btn btn-primary" onClick={startGame} disabled={players.length < 2}>
            Lancer la partie ({players.length} joueur{players.length > 1 ? 's' : ''})
          </button>
        ) : (
          <p>En attente que l'hôte lance la partie…</p>
        )}
      </div>
    )
  }

  // screen === 'game'
  const me = room.players[playerId] || { hand: [], name }
  const table = Object.entries(room.table || {})
  const openWords = table.filter(([, w]) => !w.closed && Date.now() - w.lastMoveTs <= WORD_TIMEOUT_MS)
  const closedWords = table.filter(([, w]) => w.closed || Date.now() - w.lastMoveTs > WORD_TIMEOUT_MS)

  const scores = {}
  Object.entries(room.players || {}).forEach(([id, p]) => { scores[id] = { name: p.name, score: 0 } })
  closedWords.forEach(([, w]) => {
    const wordStr = normalize(w.letters.map((l) => l.syllable).join(''))
    const bonus = trie.isWord(wordStr) ? 2 : 1
    w.letters.forEach((l) => {
      if (!scores[l.playerId]) scores[l.playerId] = { name: l.playerName, score: 0 }
      scores[l.playerId].score += bonus
    })
  })

  const allHandsEmpty = Object.values(room.players || {}).every((p) => (p.hand || []).length === 0)
  const gameOver = allHandsEmpty && openWords.length === 0

  return (
    <div className="game-screen">
      {flash && <div className={`flash flash-${flash.type}`}>{flash.text}</div>}

      <div className="scoreboard">
        {Object.entries(scores).sort((a, b) => b[1].score - a[1].score).map(([id, s]) => (
          <div key={id} className={`score-chip ${id === playerId ? 'me' : ''}`}>
            {s.name}: {s.score}
          </div>
        ))}
      </div>

      {gameOver && <div className="game-over">Partie terminée — voir le classement ci-dessus 🎉</div>}

      <div className="table-area">
        {table.length === 0 && <p className="hint">Aucun mot en cours. Pose une carte pour en démarrer un !</p>}
        {table.map(([wordId, w]) => {
          const wordStr = w.letters.map((l) => l.syllable).join('')
          const isClosed = w.closed || Date.now() - w.lastMoveTs > WORD_TIMEOUT_MS
          const isValidWord = isClosed && trie.isWord(normalize(wordStr))
          const remaining = Math.max(0, WORD_TIMEOUT_MS - (Date.now() - w.lastMoveTs))
          const canPlaceHere = !isClosed && selectedCardId && w.lastPlayerId !== playerId
          return (
            <div
              key={wordId}
              className={`word-card ${isClosed ? 'closed' : ''} ${isValidWord ? 'valid' : ''} ${canPlaceHere ? 'targetable' : ''}`}
              onClick={() => canPlaceHere && playCard(wordId)}
            >
              <div className="word-syllables">
                {w.letters.map((l, i) => <span key={i} className="syl">{l.syllable}</span>)}
              </div>
              {!isClosed && (
                <div className="timer-bar"><div className="timer-fill" style={{ width: `${(remaining / WORD_TIMEOUT_MS) * 100}%` }} /></div>
              )}
              {isClosed && <div className="word-status">{isValidWord ? '✓ mot valide (x2)' : 'clos'}</div>}
            </div>
          )
        })}
      </div>

      <div
        className={`new-word-drop ${selectedCardId ? 'active' : ''}`}
        onClick={() => selectedCardId && playCard(null)}
      >
        {selectedCardId ? 'Poser ici pour démarrer un nouveau mot' : 'Sélectionne une carte ci-dessous'}
      </div>

      <div className="hand">
        {(me.hand || []).map((c) => (
          <button
            key={c.id}
            className={`card ${selectedCardId === c.id ? 'selected' : ''}`}
            onClick={() => setSelectedCardId(selectedCardId === c.id ? null : c.id)}
          >
            {c.syllable}
          </button>
        ))}
        {(me.hand || []).length === 0 && <p className="hint">Main vide — bravo, tu as tout posé !</p>}
      </div>
    </div>
  )
}
