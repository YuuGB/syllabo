import React, { useEffect, useMemo, useState } from 'react'
import { db } from './firebase'
import {
  ref, push, set, update, onValue, runTransaction, query, orderByChild, limitToLast,
} from 'firebase/database'
import {
  buildAlphabetHand, loadTrie, normalize, VOWELS, initialMultipliers, letterValue,
} from './gameData'

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

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function loadMyRooms() {
  try {
    return JSON.parse(localStorage.getItem('syllabo_my_rooms') || '[]')
  } catch (e) {
    return []
  }
}

// L'IA cherche une lettre de sa main qui prolonge un mot existant, sinon en démarre un nouveau.
function aiChooseMove(aiHand, table, trie) {
  const openWords = shuffle(Object.entries(table).filter(([, w]) => !w.closed))
  const hand = shuffle(aiHand)
  for (const [wordId, w] of openWords) {
    const current = w.letters.map((l) => l.syllable).join('')
    for (const card of hand) {
      if (trie.hasPrefix(normalize(current + card.syllable))) {
        return { type: 'extend', wordId, card }
      }
    }
  }
  for (const card of hand) {
    if (trie.hasPrefix(normalize(card.syllable))) {
      return { type: 'new', card }
    }
  }
  return null
}

function scoreClosedWords(table, trie, filterPlayerId) {
  const scores = {}
  Object.values(table).forEach((w) => {
    if (!w.closed) return
    const wordStr = normalize(w.letters.map((l) => l.syllable).join(''))
    const bonus = trie.isWord(wordStr) ? 2 : 1
    w.letters.forEach((l) => {
      if (filterPlayerId && l.playerId !== filterPlayerId) return
      scores[l.playerId] = (scores[l.playerId] || 0) + (l.mult ?? 1) * bonus
    })
  })
  return scores
}

export default function App() {
  const [trie, setTrie] = useState(null)
  const [loadingMsg, setLoadingMsg] = useState('Chargement du dictionnaire…')
  const [screen, setScreen] = useState('home') // home | lobby | game | solo
  const [name, setName] = useState(localStorage.getItem('syllabo_name') || '')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [room, setRoom] = useState(null)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [selectedWordId, setSelectedWordId] = useState(null)
  const [flash, setFlash] = useState(null)

  const [myRoomCodes, setMyRoomCodes] = useState(loadMyRooms)
  const [myRoomsData, setMyRoomsData] = useState({})
  const [publicRooms, setPublicRooms] = useState([])

  const [solo, setSolo] = useState(null)

  const [showRules, setShowRules] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboardSolo, setLeaderboardSolo] = useState(null)
  const [leaderboardMulti, setLeaderboardMulti] = useState(null)

  const playerId = useMemo(getOrCreatePlayerId, [])

  useEffect(() => {
    loadTrie(setLoadingMsg).then(setTrie)
  }, [])

  // Abonnement à la partie multi actuellement affichée
  useEffect(() => {
    if (!roomCode) { setRoom(null); return }
    const roomRef = ref(db, `rooms/${roomCode}`)
    const unsub = onValue(roomRef, (snap) => {
      const val = snap.val()
      if (!val) {
        removeMyRoom(roomCode)
        setRoom(null)
        setRoomCode('')
        setScreen('home')
        return
      }
      setRoom(val)
      setScreen(val.status === 'playing' ? 'game' : 'lobby')
    })
    return () => unsub()
  }, [roomCode])

  // Abonnement léger à "mes parties"
  useEffect(() => {
    const unsubs = myRoomCodes.map((code) => onValue(ref(db, `rooms/${code}`), (snap) => {
      setMyRoomsData((prev) => ({ ...prev, [code]: snap.val() }))
    }))
    return () => unsubs.forEach((u) => u())
  }, [myRoomCodes.join(',')])

  // Annuaire public des parties en cours
  useEffect(() => {
    const q = query(ref(db, 'roomsIndex'), orderByChild('createdAt'), limitToLast(20))
    const unsub = onValue(q, (snap) => {
      const val = snap.val() || {}
      setPublicRooms(Object.values(val).sort((a, b) => b.createdAt - a.createdAt))
    })
    return () => unsub()
  }, [])

  // Détection de fin de partie multi -> écrit une seule fois les scores au classement
  useEffect(() => {
    if (!room || !roomCode || !trie) return
    const players = room.players || {}
    const table = room.table || {}
    if (Object.keys(players).length === 0) return
    const openCount = Object.values(table).filter((w) => !w.closed).length
    const allEmpty = Object.values(players).every((p) => (p.hand || []).length === 0)
    const over = allEmpty && openCount === 0
    if (!over || room.scoresSubmitted) return
    ;(async () => {
      const lockRef = ref(db, `rooms/${roomCode}/scoresSubmitted`)
      const result = await runTransaction(lockRef, (cur) => (cur ? undefined : true))
      if (!result.committed) return
      const namesById = {}
      Object.entries(players).forEach(([id, p]) => { namesById[id] = p.name })
      const scores = scoreClosedWords(table, trie)
      await Promise.all(Object.entries(scores).map(([id, score]) => push(ref(db, 'leaderboard/multi'), {
        name: namesById[id] || '?', score, date: Date.now(),
      })))
    })()
  }, [room, roomCode, trie])

  // Tour de l'IA en mode solo
  useEffect(() => {
    if (!solo || solo.turn !== 'ai' || solo.over || !trie) return
    const t = setTimeout(() => {
      setSolo((prev) => {
        if (!prev || prev.turn !== 'ai' || prev.over) return prev
        const move = aiChooseMove(prev.aiHand, prev.table, trie)
        if (!move) return { ...prev, turn: 'human' }
        let table = prev.table
        if (move.type === 'new') {
          const newId = 'w' + Math.random().toString(36).slice(2, 9)
          table = { ...table, [newId]: { letters: [{ syllable: move.card.syllable, playerId: 'ai', mult: 1 }], closed: false } }
        } else {
          const w = table[move.wordId]
          table = { ...table, [move.wordId]: { ...w, letters: [...w.letters, { syllable: move.card.syllable, playerId: 'ai', mult: 1 }] } }
        }
        const aiHand = prev.aiHand.filter((c) => c.id !== move.card.id)
        return { ...prev, table, aiHand, turn: 'human' }
      })
    }, 700)
    return () => clearTimeout(t)
  }, [solo?.turn, solo?.over, trie])

  function addMyRoom(code) {
    setMyRoomCodes((cur) => {
      if (cur.includes(code)) return cur
      const next = [...cur, code]
      localStorage.setItem('syllabo_my_rooms', JSON.stringify(next))
      return next
    })
  }

  function removeMyRoom(code) {
    setMyRoomCodes((cur) => {
      const next = cur.filter((c) => c !== code)
      localStorage.setItem('syllabo_my_rooms', JSON.stringify(next))
      return next
    })
    setMyRoomsData((prev) => { const next = { ...prev }; delete next[code]; return next })
  }

  function openRoom(code) { setRoomCode(code) }
  function goHome() { setRoomCode(''); setRoom(null); setScreen('home') }
  function leaveRoom() { removeMyRoom(roomCode); setRoomCode(''); setRoom(null); setScreen('home') }

  function showFlash(type, text) {
    setFlash({ type, text })
    setTimeout(() => setFlash(null), 1800)
  }

  async function bumpPlayerCount(code, delta) {
    await runTransaction(ref(db, `roomsIndex/${code}/playerCount`), (cur) => (cur ?? 0) + delta)
  }

  async function createRoom() {
    if (!name.trim()) return showFlash('error', 'Entre ton prénom')
    localStorage.setItem('syllabo_name', name)
    const code = randomCode()
    await set(ref(db, `rooms/${code}`), {
      status: 'lobby', hostId: playerId, createdAt: Date.now(),
      players: { [playerId]: { name, hand: [] } }, table: {},
    })
    await set(ref(db, `roomsIndex/${code}`), { code, createdAt: Date.now(), status: 'lobby', playerCount: 1 })
    addMyRoom(code)
    setRoomCode(code)
  }

  async function joinRoomByCode(codeInput) {
    if (!name.trim()) return showFlash('error', 'Entre ton prénom')
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    localStorage.setItem('syllabo_name', name)
    const alreadyMember = myRoomCodes.includes(code)
    await update(ref(db, `rooms/${code}/players/${playerId}`), { name, hand: [] })
    if (!alreadyMember) {
      await bumpPlayerCount(code, 1)
      addMyRoom(code)
    }
    setRoomCode(code)
  }

  async function startGame() {
    const playerIds = Object.keys(room.players || {})
    if (playerIds.length < 2) return showFlash('error', 'Il faut au moins 2 joueurs')
    const updates = {
      status: 'playing', turnOrder: shuffle(playerIds), turnIndex: 0,
      letterMultipliers: initialMultipliers(), scoresSubmitted: false,
    }
    playerIds.forEach((pid) => { updates[`players/${pid}/hand`] = buildAlphabetHand() })
    await update(ref(db, `rooms/${roomCode}`), updates)
    await update(ref(db, `roomsIndex/${roomCode}`), { status: 'playing' })
  }

  async function rematch() {
    const playerIds = Object.keys(room.players || {})
    const updates = {
      turnOrder: shuffle(playerIds), turnIndex: 0, table: {},
      letterMultipliers: initialMultipliers(), scoresSubmitted: false,
    }
    playerIds.forEach((pid) => { updates[`players/${pid}/hand`] = buildAlphabetHand() })
    await update(ref(db, `rooms/${roomCode}`), updates)
  }

  function isMyTurn() {
    return room?.turnOrder?.[room.turnIndex] === playerId
  }

  async function advanceTurn() {
    const len = room.turnOrder.length
    await runTransaction(ref(db, `rooms/${roomCode}/turnIndex`), (cur) => ((cur ?? 0) + 1) % len)
  }

  async function playCard(wordId) {
    if (!isMyTurn()) return showFlash('error', "Ce n'est pas ton tour")
    if (!selectedCardId || !room) return
    const me = room.players[playerId]
    const card = (me.hand || []).find((c) => c.id === selectedCardId)
    if (!card) return
    const mult = letterValue(card.syllable, room.letterMultipliers)

    if (wordId === null) {
      const candidate = normalize(card.syllable)
      if (!trie.hasPrefix(candidate)) {
        showFlash('error', `"${card.syllable}" ne peut démarrer aucun mot`)
        return
      }
      const newWordRef = push(ref(db, `rooms/${roomCode}/table`))
      await set(newWordRef, {
        letters: [{ syllable: card.syllable, playerId, playerName: me.name, mult }],
        closed: false,
      })
      await afterSuccessfulPlay(card)
      return
    }

    const word = room.table[wordId]
    if (word.closed) return showFlash('error', 'Ce mot est déjà clos')
    const current = word.letters.map((l) => l.syllable).join('')
    const candidate = normalize(current + card.syllable)
    if (!trie.hasPrefix(candidate)) {
      showFlash('error', `"${current}${card.syllable}" ne mène à aucun mot`)
      return
    }

    const wordRef = ref(db, `rooms/${roomCode}/table/${wordId}`)
    const result = await runTransaction(wordRef, (cur) => {
      if (!cur || cur.closed) return cur
      return { ...cur, letters: [...cur.letters, { syllable: card.syllable, playerId, playerName: me.name, mult }] }
    })
    if (!result.committed || result.snapshot.val()?.letters.length !== word.letters.length + 1) {
      showFlash('error', 'Coup refusé (le mot vient peut-être d\u2019être clos)')
      return
    }
    await afterSuccessfulPlay(card)
  }

  async function afterSuccessfulPlay(card) {
    if (VOWELS.includes(card.syllable)) {
      await runTransaction(ref(db, `rooms/${roomCode}/letterMultipliers/${card.syllable}`), (cur) => Math.max(1, (cur ?? 3) - 1))
    }
    await removeCardFromHand(card.id)
    setSelectedCardId(null)
    await advanceTurn()
  }

  async function closeWord(wordId) {
    if (!isMyTurn()) return showFlash('error', "Ce n'est pas ton tour")
    const result = await runTransaction(ref(db, `rooms/${roomCode}/table/${wordId}`), (cur) => {
      if (!cur || cur.closed) return cur
      return { ...cur, closed: true }
    })
    setSelectedWordId(null)
    if (!result.committed) return
    await advanceTurn()
  }

  async function passTurn() {
    if (!isMyTurn()) return
    setSelectedCardId(null)
    setSelectedWordId(null)
    await advanceTurn()
  }

  function handleWordClick(wordId, canPlaceHere, isClosed, myTurn) {
    if (canPlaceHere) return playCard(wordId)
    if (!myTurn || isClosed) return
    setSelectedWordId((cur) => (cur === wordId ? null : wordId))
  }

  async function removeCardFromHand(cardId) {
    await runTransaction(ref(db, `rooms/${roomCode}/players/${playerId}/hand`), (hand) => (hand || []).filter((c) => c.id !== cardId))
  }

  // --- Mode solo ---

  function startSolo() {
    if (!name.trim()) return showFlash('error', 'Entre ton prénom')
    localStorage.setItem('syllabo_name', name)
    setSolo({
      humanHand: buildAlphabetHand(), aiHand: buildAlphabetHand(), table: {},
      multipliers: initialMultipliers(), turn: 'human',
      selectedCardId: null, selectedWordId: null, over: false, finalScore: 0,
    })
    setScreen('solo')
  }

  function exitSolo() { setSolo(null); setScreen('home') }

  function finalizeSolo(nextState) {
    const finalTable = Object.fromEntries(Object.entries(nextState.table).map(([id, w]) => [id, { ...w, closed: true }]))
    const scores = scoreClosedWords(finalTable, trie, 'human')
    const score = scores.human || 0
    setSolo({ ...nextState, table: finalTable, over: true, finalScore: score, turn: 'human' })
    if (name.trim()) push(ref(db, 'leaderboard/solo'), { name: name.trim(), score, date: Date.now() })
  }

  function soloPlayCard(wordId) {
    if (!solo || solo.turn !== 'human' || solo.over) return
    const card = solo.humanHand.find((c) => c.id === solo.selectedCardId)
    if (!card) return
    let table = solo.table
    const mult = letterValue(card.syllable, solo.multipliers)

    if (wordId === null) {
      if (!trie.hasPrefix(normalize(card.syllable))) {
        return showFlash('error', `"${card.syllable}" ne peut démarrer aucun mot`)
      }
      const newId = 'w' + Math.random().toString(36).slice(2, 9)
      table = { ...table, [newId]: { letters: [{ syllable: card.syllable, playerId: 'human', mult }], closed: false } }
    } else {
      const w = table[wordId]
      if (!w || w.closed) return showFlash('error', 'Ce mot est déjà clos')
      const current = w.letters.map((l) => l.syllable).join('')
      if (!trie.hasPrefix(normalize(current + card.syllable))) {
        return showFlash('error', `"${current}${card.syllable}" ne mène à aucun mot`)
      }
      table = { ...table, [wordId]: { ...w, letters: [...w.letters, { syllable: card.syllable, playerId: 'human', mult }] } }
    }

    let multipliers = solo.multipliers
    if (VOWELS.includes(card.syllable)) {
      multipliers = { ...multipliers, [card.syllable]: Math.max(1, (multipliers[card.syllable] ?? 3) - 1) }
    }
    const humanHand = solo.humanHand.filter((c) => c.id !== card.id)
    const next = { ...solo, table, multipliers, humanHand, selectedCardId: null, selectedWordId: null }
    if (humanHand.length === 0) finalizeSolo(next)
    else setSolo({ ...next, turn: 'ai' })
  }

  function soloCloseWord(wordId) {
    if (!solo || solo.turn !== 'human' || solo.over) return
    const w = solo.table[wordId]
    if (!w || w.closed) return
    const table = { ...solo.table, [wordId]: { ...w, closed: true } }
    const next = { ...solo, table, selectedWordId: null }
    if (solo.humanHand.length === 0) finalizeSolo(next)
    else setSolo({ ...next, turn: 'ai' })
  }

  function soloPassTurn() {
    if (!solo || solo.turn !== 'human' || solo.over) return
    setSolo({ ...solo, turn: 'ai', selectedCardId: null, selectedWordId: null })
  }

  function soloHandleWordClick(wordId, canPlaceHere, isClosed) {
    if (canPlaceHere) return soloPlayCard(wordId)
    if (solo.turn !== 'human' || isClosed) return
    setSolo((prev) => ({ ...prev, selectedWordId: prev.selectedWordId === wordId ? null : wordId }))
  }

  // --- Classement ---

  function openLeaderboard() {
    setShowLeaderboard(true)
    onValue(query(ref(db, 'leaderboard/solo'), orderByChild('score'), limitToLast(10)), (snap) => {
      setLeaderboardSolo(Object.values(snap.val() || {}).sort((a, b) => b.score - a.score))
    }, { onlyOnce: true })
    onValue(query(ref(db, 'leaderboard/multi'), orderByChild('score'), limitToLast(10)), (snap) => {
      setLeaderboardMulti(Object.values(snap.val() || {}).sort((a, b) => b.score - a.score))
    }, { onlyOnce: true })
  }

  // --- Rendu ---

  if (!trie) {
    return <div className="center-screen"><div className="loader" /><p>{loadingMsg}</p></div>
  }

  if (screen === 'home') {
    return (
      <div className="center-screen">
        <h1 className="logo">Syllabo</h1>
        <p className="tagline">Construisez des mots à plusieurs, lettre par lettre.</p>

        <div className="top-links">
          <button className="link-btn" onClick={() => setShowRules(true)}>📖 Règles du jeu</button>
          <button className="link-btn" onClick={openLeaderboard}>🏆 Classement</button>
        </div>

        <input className="input" placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" onClick={createRoom}>Créer une partie</button>
        <button className="btn" onClick={startSolo}>Jouer en solo (vs IA)</button>
        <div className="divider">ou</div>
        <input
          className="input" placeholder="Code de la partie" value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={4}
        />
        <button className="btn" onClick={() => joinRoomByCode(joinCode)}>Rejoindre</button>

        {myRoomCodes.length > 0 && (
          <div className="rooms-section">
            <h3>Mes parties</h3>
            {myRoomCodes.map((code) => {
              const r = myRoomsData[code]
              if (!r) return null
              const count = Object.keys(r.players || {}).length
              return (
                <button key={code} className="room-item" onClick={() => openRoom(code)}>
                  <span className="room-item-code">{code}</span>
                  <span>{count} joueur{count > 1 ? 's' : ''}</span>
                  <span className="room-item-status">{r.status === 'lobby' ? 'salon' : 'en cours'}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="rooms-section">
          <h3>Parties en cours</h3>
          {publicRooms.length === 0 && <p className="hint">Aucune partie publique pour l'instant</p>}
          {publicRooms.filter((r) => !myRoomCodes.includes(r.code)).map((r) => (
            <button key={r.code} className="room-item" onClick={() => joinRoomByCode(r.code)}>
              <span className="room-item-code">{r.code}</span>
              <span>{r.playerCount} joueur{r.playerCount > 1 ? 's' : ''}</span>
              <span className="room-item-status">{r.status === 'lobby' ? 'salon ouvert' : 'en cours'}</span>
            </button>
          ))}
        </div>

        {showRules && (
          <div className="modal-overlay" onClick={() => setShowRules(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h2>Règles du jeu</h2>
              <p><strong>But :</strong> marquer un maximum de points en posant tes lettres pour construire des mots, seul ou à plusieurs.</p>
              <ul>
                <li>Chaque joueur reçoit les 26 lettres de l'alphabet, une seule fois chacune.</li>
                <li>À ton tour : pose une lettre en fin d'un mot en cours, démarre un nouveau mot, clos un mot ouvert, ou passe.</li>
                <li>Chaque lettre est validée immédiatement contre le dictionnaire français : impossible de poser une lettre qui ne mène à aucun mot.</li>
                <li>Les voyelles (A, E, I, O, U, Y) valent x3 au début, puis leur valeur diminue de 1 à chaque utilisation (par n'importe qui) jusqu'à un plancher de x1. Les consonnes valent toujours 1 point.</li>
                <li>Un mot clos rapporte, à chaque joueur qui y a contribué, la somme des valeurs de ses lettres — doublée si le mot final est valide dans le dictionnaire.</li>
                <li>La partie se termine quand toutes les mains sont vides et tous les mots clos.</li>
                <li><strong>Mode solo :</strong> tu affrontes une IA qui ajoute une lettre valide à chaque tour pour faire avancer les mots. Seules tes propres lettres comptent pour ton score final.</li>
              </ul>
              <button className="btn btn-primary" onClick={() => setShowRules(false)}>Compris</button>
            </div>
          </div>
        )}

        {showLeaderboard && (
          <div className="modal-overlay" onClick={() => setShowLeaderboard(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h2>Classement</h2>
              <h3>🏆 Top 10 solo</h3>
              {leaderboardSolo === null && <p className="hint">Chargement…</p>}
              {leaderboardSolo?.length === 0 && <p className="hint">Aucun score pour l'instant</p>}
              <ol className="leaderboard-list">
                {leaderboardSolo?.map((e, i) => <li key={i}>{e.name} — {e.score} pts</li>)}
              </ol>
              <h3>🏆 Top 10 multijoueur</h3>
              {leaderboardMulti === null && <p className="hint">Chargement…</p>}
              {leaderboardMulti?.length === 0 && <p className="hint">Aucun score pour l'instant</p>}
              <ol className="leaderboard-list">
                {leaderboardMulti?.map((e, i) => <li key={i}>{e.name} — {e.score} pts</li>)}
              </ol>
              <button className="btn btn-primary" onClick={() => setShowLeaderboard(false)}>Fermer</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- Écran solo ---
  if (screen === 'solo' && solo) {
    if (solo.over) {
      return (
        <div className="center-screen end-screen">
          <h1 className="logo">Partie terminée 🎉</h1>
          <div className="final-ranking">
            <div className="rank-row winner">
              <span className="rank-pos">🏆</span>
              <span className="rank-name">{name}</span>
              <span className="rank-score">{solo.finalScore} pts</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={startSolo}>Rejouer</button>
          <button className="btn" onClick={exitSolo}>← Accueil</button>
        </div>
      )
    }

    const table = Object.entries(solo.table)
    const myTurn = solo.turn === 'human'
    return (
      <div className="game-screen">
        {flash && <div className={`flash flash-${flash.type}`}>{flash.text}</div>}
        <div className="top-bar">
          <button className="home-btn" onClick={exitSolo}>← Accueil</button>
          <span className="code-badge">Mode solo</span>
        </div>
        <div className={`turn-banner ${myTurn ? 'my-turn' : ''}`}>{myTurn ? 'C\u2019est ton tour !' : 'L\u2019IA réfléchit…'}</div>
        <div className="table-area">
          {table.length === 0 && <p className="hint">Aucun mot en cours. Pose une lettre pour en démarrer un !</p>}
          {table.map(([wordId, w]) => {
            const wordStr = w.letters.map((l) => l.syllable).join('')
            const isValidWord = w.closed && trie.isWord(normalize(wordStr))
            const canPlaceHere = !w.closed && myTurn && !!solo.selectedCardId
            const isSelected = solo.selectedWordId === wordId
            return (
              <div
                key={wordId}
                className={`word-card ${w.closed ? 'closed' : ''} ${isValidWord ? 'valid' : ''} ${canPlaceHere ? 'targetable' : ''} ${isSelected ? 'selected-word' : ''}`}
                onClick={() => soloHandleWordClick(wordId, canPlaceHere, w.closed)}
              >
                <div className="word-syllables">
                  {w.letters.map((l, i) => (
                    <span key={i} className={`syl ${l.playerId === 'ai' ? 'syl-ai' : ''}`}>{l.syllable}</span>
                  ))}
                </div>
                {w.closed && <div className="word-status">{isValidWord ? '✓ mot valide (x2)' : 'clos'}</div>}
              </div>
            )
          })}
        </div>
        {myTurn && (
          <div className="action-bar">
            {solo.selectedCardId && (
              <button className="btn btn-primary" onClick={() => soloPlayCard(null)}>Démarrer un nouveau mot</button>
            )}
            {solo.selectedWordId && !solo.selectedCardId && (
              <button className="btn btn-close" onClick={() => soloCloseWord(solo.selectedWordId)}>
                Clore « {solo.table[solo.selectedWordId].letters.map((l) => l.syllable).join('')} »
              </button>
            )}
            {!solo.selectedCardId && !solo.selectedWordId && (
              <p className="hint">Sélectionne une lettre pour jouer, ou un mot pour le clore</p>
            )}
            <button className="btn pass-btn" onClick={soloPassTurn}>Passer mon tour</button>
          </div>
        )}
        <div className="hand">
          {solo.humanHand.map((c) => {
            const val = letterValue(c.syllable, solo.multipliers)
            return (
              <button
                key={c.id}
                className={`card ${solo.selectedCardId === c.id ? 'selected' : ''}`}
                onClick={() => myTurn && setSolo((prev) => ({ ...prev, selectedWordId: null, selectedCardId: prev.selectedCardId === c.id ? null : c.id }))}
                disabled={!myTurn}
              >
                {c.syllable}
                {VOWELS.includes(c.syllable) && <span className="card-mult">x{val}</span>}
              </button>
            )
          })}
          {solo.humanHand.length === 0 && <p className="hint">Main vide !</p>}
        </div>
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
        <button className="btn" onClick={goHome}>← Accueil (garder ma place)</button>
        <button className="btn leave-btn" onClick={leaveRoom}>Quitter définitivement</button>
      </div>
    )
  }

  // screen === 'game'
  const me = room.players[playerId] || { hand: [], name }
  const table = Object.entries(room.table || {})
  const openWords = table.filter(([, w]) => !w.closed)
  const myTurn = isMyTurn()
  const currentPlayerName = room.players?.[room.turnOrder?.[room.turnIndex]]?.name || '…'

  const scoreValues = scoreClosedWords(room.table || {}, trie)
  const scores = {}
  Object.entries(room.players || {}).forEach(([id, p]) => { scores[id] = { name: p.name, score: scoreValues[id] || 0 } })

  const allHandsEmpty = Object.values(room.players || {}).every((p) => (p.hand || []).length === 0)
  const gameOver = allHandsEmpty && openWords.length === 0

  if (gameOver) {
    const ranking = Object.entries(scores).sort((a, b) => b[1].score - a[1].score)
    const topScore = ranking[0]?.[1].score
    return (
      <div className="center-screen end-screen">
        <h1 className="logo">Partie terminée 🎉</h1>
        <div className="final-ranking">
          {ranking.map(([id, s], i) => (
            <div key={id} className={`rank-row ${s.score === topScore ? 'winner' : ''}`}>
              <span className="rank-pos">{i === 0 ? '🏆' : `${i + 1}.`}</span>
              <span className="rank-name">{s.name}{id === playerId ? ' (toi)' : ''}</span>
              <span className="rank-score">{s.score} pts</span>
            </div>
          ))}
        </div>
        {room.hostId === playerId ? (
          <button className="btn btn-primary" onClick={rematch}>Rejouer une manche</button>
        ) : (
          <p className="hint">En attente que l'hôte relance une manche…</p>
        )}
        <button className="btn" onClick={goHome}>← Mes parties</button>
        <button className="btn leave-btn" onClick={leaveRoom}>Quitter définitivement</button>
      </div>
    )
  }

  return (
    <div className="game-screen">
      {flash && <div className={`flash flash-${flash.type}`}>{flash.text}</div>}

      <div className="top-bar">
        <button className="home-btn" onClick={goHome}>← Mes parties</button>
        <span className="code-badge">{roomCode}</span>
      </div>

      <div className="scoreboard">
        {Object.entries(scores).sort((a, b) => b[1].score - a[1].score).map(([id, s]) => (
          <div key={id} className={`score-chip ${id === playerId ? 'me' : ''}`}>{s.name}: {s.score}</div>
        ))}
      </div>

      <div className={`turn-banner ${myTurn ? 'my-turn' : ''}`}>
        {myTurn ? 'C\u2019est ton tour !' : `Tour de ${currentPlayerName}`}
      </div>

      <div className="table-area">
        {table.length === 0 && <p className="hint">Aucun mot en cours. Pose une carte pour en démarrer un !</p>}
        {table.map(([wordId, w]) => {
          const wordStr = w.letters.map((l) => l.syllable).join('')
          const isValidWord = w.closed && trie.isWord(normalize(wordStr))
          const canPlaceHere = !w.closed && myTurn && !!selectedCardId
          const isSelected = selectedWordId === wordId
          return (
            <div
              key={wordId}
              className={`word-card ${w.closed ? 'closed' : ''} ${isValidWord ? 'valid' : ''} ${canPlaceHere ? 'targetable' : ''} ${isSelected ? 'selected-word' : ''}`}
              onClick={() => handleWordClick(wordId, canPlaceHere, w.closed, myTurn)}
            >
              <div className="word-syllables">
                {w.letters.map((l, i) => <span key={i} className="syl">{l.syllable}</span>)}
              </div>
              {w.closed && <div className="word-status">{isValidWord ? '✓ mot valide (x2)' : 'clos'}</div>}
            </div>
          )
        })}
      </div>

      {myTurn && (
        <div className="action-bar">
          {selectedCardId && (
            <button className="btn btn-primary" onClick={() => playCard(null)}>Démarrer un nouveau mot</button>
          )}
          {selectedWordId && !selectedCardId && (
            <button className="btn btn-close" onClick={() => closeWord(selectedWordId)}>
              Clore « {room.table[selectedWordId].letters.map((l) => l.syllable).join('')} »
            </button>
          )}
          {!selectedCardId && !selectedWordId && (
            <p className="hint">Sélectionne une carte pour jouer, ou un mot pour le clore</p>
          )}
          <button className="btn pass-btn" onClick={passTurn}>Passer mon tour</button>
        </div>
      )}

      <div className="hand">
        {(me.hand || []).map((c) => {
          const val = letterValue(c.syllable, room.letterMultipliers)
          return (
            <button
              key={c.id}
              className={`card ${selectedCardId === c.id ? 'selected' : ''}`}
              onClick={() => myTurn && (setSelectedWordId(null), setSelectedCardId(selectedCardId === c.id ? null : c.id))}
              disabled={!myTurn}
            >
              {c.syllable}
              {VOWELS.includes(c.syllable) && <span className="card-mult">x{val}</span>}
            </button>
          )
        })}
        {(me.hand || []).length === 0 && <p className="hint">Main vide — bravo, tu as tout posé !</p>}
      </div>
    </div>
  )
}
