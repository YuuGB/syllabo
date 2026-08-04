import React, { useEffect, useMemo, useState } from 'react'
import { db } from './firebase'
import {
  ref, push, set, update, onValue, runTransaction, query, orderByChild, limitToLast,
} from 'firebase/database'
import { buildAlphabetHand, loadTrie, normalize } from './gameData'

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

export default function App() {
  const [trie, setTrie] = useState(null)
  const [loadingMsg, setLoadingMsg] = useState('Chargement du dictionnaire…')
  const [screen, setScreen] = useState('home') // home | lobby | game
  const [name, setName] = useState(localStorage.getItem('syllabo_name') || '')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [room, setRoom] = useState(null)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [selectedWordId, setSelectedWordId] = useState(null)
  const [flash, setFlash] = useState(null) // { type: 'error'|'ok', text }

  const [myRoomCodes, setMyRoomCodes] = useState(loadMyRooms)
  const [myRoomsData, setMyRoomsData] = useState({}) // code -> room snapshot
  const [publicRooms, setPublicRooms] = useState([]) // annuaire léger (roomsIndex)

  const playerId = useMemo(getOrCreatePlayerId, [])

  useEffect(() => {
    loadTrie(setLoadingMsg).then(setTrie)
  }, [])

  // Abonnement à la partie actuellement affichée
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

  // Abonnement léger à toutes les parties auxquelles je participe (pour la liste "Mes parties")
  useEffect(() => {
    const unsubs = myRoomCodes.map((code) => onValue(ref(db, `rooms/${code}`), (snap) => {
      setMyRoomsData((prev) => ({ ...prev, [code]: snap.val() }))
    }))
    return () => unsubs.forEach((u) => u())
  }, [myRoomCodes.join(',')])

  // Abonnement à l'annuaire public des parties en cours (infos légères uniquement)
  useEffect(() => {
    const q = query(ref(db, 'roomsIndex'), orderByChild('createdAt'), limitToLast(20))
    const unsub = onValue(q, (snap) => {
      const val = snap.val() || {}
      const list = Object.values(val).sort((a, b) => b.createdAt - a.createdAt)
      setPublicRooms(list)
    })
    return () => unsub()
  }, [])

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
    setMyRoomsData((prev) => {
      const next = { ...prev }
      delete next[code]
      return next
    })
  }

  function openRoom(code) {
    setRoomCode(code)
  }

  function goHome() {
    setRoomCode('')
    setRoom(null)
    setScreen('home')
  }

  function leaveRoom() {
    removeMyRoom(roomCode)
    setRoomCode('')
    setRoom(null)
    setScreen('home')
  }

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
      status: 'lobby',
      hostId: playerId,
      createdAt: Date.now(),
      players: { [playerId]: { name, hand: [] } },
      table: {},
    })
    await set(ref(db, `roomsIndex/${code}`), {
      code, createdAt: Date.now(), status: 'lobby', playerCount: 1,
    })
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
    const updates = { status: 'playing', turnOrder: shuffle(playerIds), turnIndex: 0 }
    playerIds.forEach((pid) => {
      updates[`players/${pid}/hand`] = buildAlphabetHand()
    })
    await update(ref(db, `rooms/${roomCode}`), updates)
    await update(ref(db, `roomsIndex/${roomCode}`), { status: 'playing' })
  }

  function isMyTurn() {
    return room?.turnOrder?.[room.turnIndex] === playerId
  }

  async function advanceTurn() {
    const turnIndexRef = ref(db, `rooms/${roomCode}/turnIndex`)
    const len = room.turnOrder.length
    await runTransaction(turnIndexRef, (cur) => ((cur ?? 0) + 1) % len)
  }

  // Tente de poser la carte sélectionnée sur un mot existant (wordId) ou d'en démarrer un nouveau (wordId = null)
  async function playCard(wordId) {
    if (!isMyTurn()) return showFlash('error', "Ce n'est pas ton tour")
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
        closed: false,
      })
      await removeCardFromHand(card.id)
      setSelectedCardId(null)
      await advanceTurn()
      return
    }

    const word = room.table[wordId]
    if (word.closed) {
      showFlash('error', 'Ce mot est déjà clos')
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
      return {
        ...cur,
        letters: [...cur.letters, { syllable: card.syllable, playerId, playerName: me.name }],
      }
    })

    if (!result.committed || result.snapshot.val()?.letters.length !== word.letters.length + 1) {
      showFlash('error', 'Coup refusé (le mot vient peut-être d\u2019être clos)')
      return
    }

    await removeCardFromHand(card.id)
    setSelectedCardId(null)
    await advanceTurn()
  }

  async function closeWord(wordId) {
    if (!isMyTurn()) return showFlash('error', "Ce n'est pas ton tour")
    const wordRef = ref(db, `rooms/${roomCode}/table/${wordId}`)
    const result = await runTransaction(wordRef, (cur) => {
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
    if (canPlaceHere) {
      playCard(wordId)
      return
    }
    if (!myTurn || isClosed) return
    setSelectedWordId((cur) => (cur === wordId ? null : wordId))
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
        <p className="tagline">Construisez des mots à plusieurs, lettre par lettre.</p>
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
          {publicRooms
            .filter((r) => !myRoomCodes.includes(r.code))
            .map((r) => (
              <button key={r.code} className="room-item" onClick={() => joinRoomByCode(r.code)}>
                <span className="room-item-code">{r.code}</span>
                <span>{r.playerCount} joueur{r.playerCount > 1 ? 's' : ''}</span>
                <span className="room-item-status">{r.status === 'lobby' ? 'salon ouvert' : 'en cours'}</span>
              </button>
            ))}
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
  const closedWords = table.filter(([, w]) => w.closed)
  const myTurn = isMyTurn()
  const currentPlayerName = room.players?.[room.turnOrder?.[room.turnIndex]]?.name || '…'

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

      <div className="top-bar">
        <button className="home-btn" onClick={goHome}>← Mes parties</button>
        <span className="code-badge">{roomCode}</span>
      </div>

      <div className="scoreboard">
        {Object.entries(scores).sort((a, b) => b[1].score - a[1].score).map(([id, s]) => (
          <div key={id} className={`score-chip ${id === playerId ? 'me' : ''}`}>
            {s.name}: {s.score}
          </div>
        ))}
      </div>

      {!gameOver && (
        <div className={`turn-banner ${myTurn ? 'my-turn' : ''}`}>
          {myTurn ? 'C\u2019est ton tour !' : `Tour de ${currentPlayerName}`}
        </div>
      )}

      {gameOver && (
        <div className="game-over">
          Partie terminée — voir le classement ci-dessus 🎉
          <button className="btn leave-btn" onClick={leaveRoom}>Quitter la partie</button>
        </div>
      )}

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

      {myTurn && !gameOver && (
        <div className="action-bar">
          {selectedCardId && (
            <button className="btn btn-primary" onClick={() => playCard(null)}>
              Démarrer un nouveau mot
            </button>
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
        {(me.hand || []).map((c) => (
          <button
            key={c.id}
            className={`card ${selectedCardId === c.id ? 'selected' : ''}`}
            onClick={() => myTurn && (setSelectedWordId(null), setSelectedCardId(selectedCardId === c.id ? null : c.id))}
            disabled={!myTurn}
          >
            {c.syllable}
          </button>
        ))}
        {(me.hand || []).length === 0 && <p className="hint">Main vide — bravo, tu as tout posé !</p>}
      </div>
    </div>
  )
}
