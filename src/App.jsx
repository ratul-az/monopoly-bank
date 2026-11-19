
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Landmark, Users, ShieldCheck, ArrowRight, Coins, LockKeyhole,
  Crown, Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw,
  Play, Pause, RotateCcw, LogOut, History, Send, Banknote,
  Settings2, CircleAlert, CheckCircle2, Copy
} from 'lucide-react'
import { supabase } from './lib/supabase'
import './App.css'

const money = (value) =>
  new Intl.NumberFormat('en-MY', {
    maximumFractionDigits: 0
  }).format(Number(value || 0))

const dateTime = (value) =>
  new Date(value).toLocaleString()

function App() {
  const [mode, setMode] = useState('home')
  const [playerName, setPlayerName] = useState('')
  const [pin, setPin] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [startingBalance, setStartingBalance] = useState('1500')

  const [session, setSession] = useState(null)
  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [transactions, setTransactions] = useState([])

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [operation, setOperation] = useState('transfer')
  const [targetPlayer, setTargetPlayer] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const [adjustPlayer, setAdjustPlayer] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustNote, setAdjustNote] = useState('')

  const [historyFilter, setHistoryFilter] = useState('all')

  const currentPlayer = useMemo(
    () => players.find((p) => p.id === session?.playerId),
    [players, session]
  )

  const isHost = currentPlayer?.role === 'host'
  const gameStatus = room?.status || 'waiting'

  const availableRecipients = players.filter(
    (p) => p.id !== session?.playerId
  )

  const visibleTransactions = useMemo(() => {
    if (isHost || historyFilter === 'all') return transactions

    return transactions.filter(
      (t) =>
        t.from_player_id === session?.playerId ||
        t.to_player_id === session?.playerId
    )
  }, [transactions, isHost, historyFilter, session])

  function clearMessages() {
    setErrorMessage('')
    setSuccessMessage('')
  }

  function notifyError(error) {
    console.error(error)
    setErrorMessage(error?.message || 'Something went wrong.')
    setSuccessMessage('')
  }

  function notifySuccess(message) {
    setSuccessMessage(message)
    setErrorMessage('')
  }

  async function ensureSignedIn() {
    const { data, error } = await supabase.auth.getSession()

    if (error) throw error

    if (data.session) return

    const { error: signInError } =
      await supabase.auth.signInAnonymously()

    if (signInError) throw signInError
  }

  const loadDashboard = useCallback(async (roomId) => {
    if (!roomId) return

    const [
      roomResponse,
      playerResponse,
      transactionResponse
    ] = await Promise.all([
      supabase
        .from('game_rooms')
        .select('id, room_code, starting_balance, status, created_at')
        .eq('id', roomId)
        .single(),

      supabase
        .from('game_players')
        .select('id, display_name, seat, role, balance, is_connected, created_at')
        .eq('room_id', roomId)
        .order('seat'),

      supabase
        .from('bank_transactions')
        .select('id, room_id, actor_user_id, from_player_id, to_player_id, amount, transaction_type, note, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(100)
    ])

    if (roomResponse.error) throw roomResponse.error
    if (playerResponse.error) throw playerResponse.error
    if (transactionResponse.error) throw transactionResponse.error

    setRoom(roomResponse.data)
    setPlayers(playerResponse.data || [])
    setTransactions(transactionResponse.data || [])
  }, [])

  async function refreshDashboard() {
    if (!session?.roomId) return

    setRefreshing(true)
    clearMessages()

    try {
      await loadDashboard(session.roomId)
    } catch (error) {
      notifyError(error)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!session?.roomId) return

    loadDashboard(session.roomId).catch(notifyError)

    const channel = supabase
      .channel(`monopoly-room-${session.roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_rooms',
          filter: `id=eq.${session.roomId}`
        },
        () => loadDashboard(session.roomId).catch(notifyError)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_players',
          filter: `room_id=eq.${session.roomId}`
        },
        () => loadDashboard(session.roomId).catch(notifyError)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bank_transactions',
          filter: `room_id=eq.${session.roomId}`
        },
        () => loadDashboard(session.roomId).catch(notifyError)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.roomId, loadDashboard])

  async function handleRoomSubmit(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)

    try {
      await ensureSignedIn()

      let data
      let error

      if (mode === 'create') {
        const balance = Number(startingBalance)

        if (
          !Number.isSafeInteger(balance) ||
          balance < 0 ||
          balance > 1000000000
        ) {
          throw new Error('Enter a valid starting balance.')
        }

        const response = await supabase.rpc('create_game_room', {
          p_display_name: playerName.trim(),
          p_pin: pin,
          p_starting_balance: balance
        })

        data = response.data
        error = response.error
      } else {
        const response = await supabase.rpc('join_game_room', {
          p_room_code: roomCode.trim().toUpperCase(),
          p_display_name: playerName.trim(),
          p_pin: pin
        })

        data = response.data
        error = response.error
      }

      if (error) throw error

      const row = Array.isArray(data) ? data[0] : data

      if (!row) throw new Error('No room details were returned.')

      const newSession = {
        roomId: row.room_id,
        playerId: row.player_id,
        role: mode === 'create' ? 'host' : row.player_role,
        seat: mode === 'create' ? 1 : row.seat,
        playerName: playerName.trim()
      }

      setSession(newSession)
      setPin('')
      setMode('dashboard')
    } catch (error) {
      notifyError(error)
    } finally {
      setLoading(false)
    }
  }

  async function runOperation(callback, successText) {
    clearMessages()
    setLoading(true)

    try {
      const { error } = await callback()
      if (error) throw error

      await loadDashboard(session.roomId)
      notifySuccess(successText)

      setAmount('')
      setNote('')
      setAdjustAmount('')
      setAdjustNote('')
    } catch (error) {
      notifyError(error)
    } finally {
      setLoading(false)
    }
  }

  async function handleTransfer(e) {
    e.preventDefault()

    const value = Number(amount)

    if (!Number.isSafeInteger(value) || value <= 0) {
      return notifyError(new Error('Enter a valid positive amount.'))
    }

    if (!targetPlayer) {
      return notifyError(new Error('Select a recipient.'))
    }

    await runOperation(
      () => supabase.rpc('transfer_money', {
        p_to_player_id: targetPlayer,
        p_amount: value,
        p_note: note.trim() || null
      }),
      'Transfer completed successfully.'
    )
  }

  async function handleBankPayment(e) {
    e.preventDefault()

    const value = Number(amount)

    if (!Number.isSafeInteger(value) || value <= 0) {
      return notifyError(new Error('Enter a valid positive amount.'))
    }

    await runOperation(
      () => supabase.rpc('pay_bank', {
        p_amount: value,
        p_note: note.trim() || 'Bank payment'
      }),
      'Bank payment completed.'
    )
  }

  async function handleHostAdjustment(e) {
    e.preventDefault()

    const value = Number(adjustAmount)

    if (
      !Number.isSafeInteger(value) ||
      value === 0 ||
      Math.abs(value) > 1000000000
    ) {
      return notifyError(
        new Error('Enter a valid non-zero adjustment amount.')
      )
    }

    if (!adjustPlayer) {
      return notifyError(new Error('Select a player.'))
    }

    await runOperation(
      () => supabase.rpc('host_adjust_balance', {
        p_player_id: adjustPlayer,
        p_amount: value,
        p_note: adjustNote.trim() || 'Host balance adjustment'
      }),
      'Player balance adjusted successfully.'
    )
  }

  async function changeGameStatus(status) {
    await runOperation(
      () => supabase.rpc('host_set_game_status', {
        p_status: status
      }),
      `Game status changed to ${status}.`
    )
  }

  async function resetGame() {
    if (!window.confirm('Reset every player balance to the starting balance?')) {
      return
    }

    await runOperation(
      () => supabase.rpc('host_reset_game'),
      'Game has been reset.'
    )
  }

  function leaveDashboard() {
    setSession(null)
    setRoom(null)
    setPlayers([])
    setTransactions([])
    setMode('home')
    clearMessages()
    setRoomCode('')
    setPlayerName('')
    setPin('')
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room?.room_code || '')
      notifySuccess('Room code copied.')
    } catch {
      notifyError(new Error('Unable to copy room code.'))
    }
  }

  function transactionDescription(t) {
    const sender = players.find((p) => p.id === t.from_player_id)
    const recipient = players.find((p) => p.id === t.to_player_id)

    switch (t.transaction_type) {
      case 'transfer':
        return `${sender?.display_name || 'Player'} → ${recipient?.display_name || 'Player'}`
      case 'bank_payment':
        return `${sender?.display_name || 'Player'} paid the bank`
      case 'bank_credit':
        return `Bank credited ${recipient?.display_name || 'player'}`
      case 'adjustment':
        return `Host adjusted ${recipient?.display_name || 'player'}`
      case 'starting_balance':
        return `Starting balance: ${recipient?.display_name || 'player'}`
      case 'reset':
        return `Game balance reset: ${recipient?.display_name || 'player'}`
      default:
        return t.transaction_type
    }
  }

  function playerBalanceChange(t) {
    if (t.from_player_id === session?.playerId) {
      return -Number(t.amount)
    }

    if (t.to_player_id === session?.playerId) {
      return Number(t.amount)
    }

    return null
  }

  function goHome() {
    setMode('home')
    clearMessages()
  }

  return (
    <main className="app">
      <nav className="navbar">
        <div className="brand">
          <div className="brand-icon"><Landmark size={23} /></div>
          <span>MONOPOLY<span className="gold"> BANK</span></span>
        </div>

        <div className="nav-status">
          <span className="status-dot" />
          PRIVATE GAME SYSTEM
        </div>
      </nav>

      {mode !== 'dashboard' ? (
        <>
          <section className="hero-section">
            <div className="hero-content">
              <div className="eyebrow">
                <span /> THE ULTIMATE BANKING EXPERIENCE
              </div>

              <h1>
                Every move.<br />
                Every <span>fortune.</span>
              </h1>

              <p className="hero-description">
                Your private Monopoly banking room. Manage money,
                transfer fortunes and take control of the game.
              </p>

              <div className="feature-row">
                <div><ShieldCheck size={18} /> Secure rooms</div>
                <div><Users size={18} /> 3 players</div>
                <div><Coins size={18} /> Live banking</div>
              </div>
            </div>

            <div className="bank-visual">
              <div className="visual-glow" />
              <div className="coin coin-one">M</div>
              <div className="coin coin-two">M</div>
              <div className="bank-card">
                <div className="card-top">
                  <Landmark size={27} />
                  <span>PRIVATE BANK</span>
                </div>
                <div className="card-line" />
                <div className="card-balance">1,500</div>
                <div className="card-currency">MONOPOLY CREDITS</div>
                <div className="card-bottom">
                  <span>MONOPOLY BANK</span>
                  <Crown size={20} />
                </div>
              </div>
            </div>
          </section>

          <section className="access-section">
            <div className="section-heading">
              <span>GET STARTED</span>
              <h2>Your game. Your rules.</h2>
              <p>Create a private room or join an existing game.</p>
            </div>

            {mode === 'home' ? (
              <div className="choice-grid">
                <button
                  className="choice-card"
                  onClick={() => { setMode('create'); clearMessages() }}
                >
                  <div className="choice-icon"><Crown size={25} /></div>
                  <h3>Create a room</h3>
                  <p>Become the host and manage the entire bank.</p>
                  <div className="choice-link">
                    CREATE PRIVATE ROOM <ArrowRight size={17} />
                  </div>
                </button>

                <button
                  className="choice-card"
                  onClick={() => { setMode('join'); clearMessages() }}
                >
                  <div className="choice-icon"><Users size={25} /></div>
                  <h3>Join a room</h3>
                  <p>Enter your private room code and start playing.</p>
                  <div className="choice-link">
                    JOIN EXISTING ROOM <ArrowRight size={17} />
                  </div>
                </button>
              </div>
            ) : (
              <form className="access-form" onSubmit={handleRoomSubmit}>
                <button type="button" className="back-link" onClick={goHome}>
                  ← Back
                </button>

                <h3>
                  {mode === 'create'
                    ? 'Create your private room'
                    : 'Join a private room'}
                </h3>

                <p className="form-description">
                  {mode === 'create'
                    ? 'Set up your profile and become the bank administrator.'
                    : 'Enter your room details to access your game.'}
                </p>

                {errorMessage && (
                  <div className="error-message">{errorMessage}</div>
                )}

                {mode === 'join' && (
                  <label>
                    ROOM CODE
                    <input
                      value={roomCode}
                      onChange={(e) =>
                        setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                      }
                      placeholder="A8K29P"
                      maxLength={6}
                      minLength={6}
                      required
                    />
                  </label>
                )}

                <label>
                  PLAYER NAME
                  <input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter your name"
                    maxLength={24}
                    required
                  />
                </label>

                <label>
                  PRIVATE PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, '').slice(0, 8))
                    }
                    placeholder="4–8 digit PIN"
                    minLength={4}
                    maxLength={8}
                    required
                  />
                </label>

                {mode === 'create' && (
                  <label>
                    STARTING BALANCE
                    <input
                      type="number"
                      min="0"
                      max="1000000000"
                      value={startingBalance}
                      onChange={(e) => setStartingBalance(e.target.value)}
                      required
                    />
                  </label>
                )}

                <button className="submit-button" type="submit" disabled={loading}>
                  {loading ? 'PLEASE WAIT...' :
                    mode === 'create' ? 'CREATE PRIVATE ROOM' : 'JOIN GAME'}
                  {!loading && <ArrowRight size={18} />}
                </button>
              </form>
            )}
          </section>
        </>
      ) : (
        <section className="access-section dashboard">
          <div className="dashboard-top">
            <div>
              <div className="eyebrow">
                <span /> PRIVATE BANKING ROOM
              </div>
              <h1 className="dashboard-title">Game dashboard</h1>
              <p className="form-description">
                Welcome, {session?.playerName}
              </p>
            </div>

            <button className="back-link" onClick={leaveDashboard}>
              <LogOut size={16} /> Leave
            </button>
          </div>

          <div className="room-banner">
            <div>
              <span className="room-label">ROOM CODE</span>
              <div className="room-code-row">
                <strong>{room?.room_code || 'Loading...'}</strong>
                <button onClick={copyRoomCode} title="Copy room code">
                  <Copy size={17} />
                </button>
              </div>
            </div>

            <div className="room-status">
              <span className={`status-pill ${gameStatus}`}>
                {gameStatus.toUpperCase()}
              </span>
              <span>{players.length}/3 players</span>
            </div>
          </div>

          {(errorMessage || successMessage) && (
            <div className={errorMessage ? 'error-message' : 'success-message'}>
              {errorMessage
                ? <><CircleAlert size={16} /> {errorMessage}</>
                : <><CheckCircle2 size={16} /> {successMessage}</>}
            </div>
          )}

          <div className="dashboard-heading">
            <h2><Users size={21} /> Player balances</h2>
            <button
              className="refresh-button"
              onClick={refreshDashboard}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
              Refresh
            </button>
          </div>

          <div className="player-grid">
            {[1, 2, 3].map((seat) => {
              const player = players.find((p) => p.seat === seat)
              const self = player?.id === session?.playerId

              return (
                <article className={`player-card ${self ? 'self-card' : ''}`} key={seat}>
                  <div className="player-card-top">
                    <div className="player-avatar">
                      {player?.role === 'host'
                        ? <Crown size={23} />
                        : <Users size={22} />}
                    </div>
                    <span className="seat-label">PLAYER {seat}</span>
                  </div>

                  {player ? (
                    <>
                      <h3>{player.display_name} {self && '(You)'}</h3>
                      <span className="player-role">
                        {player.role === 'host' ? 'BANK ADMINISTRATOR' : 'PLAYER'}
                      </span>
                      <div className="balance-value">
                        <small>RM</small> {money(player.balance)}
                      </div>
                      <span className="player-online">
                        <span /> Connected
                      </span>
                    </>
                  ) : (
                    <>
                      <h3>Waiting for player</h3>
                      <span className="player-role">EMPTY SEAT</span>
                      <div className="balance-value empty-balance">---</div>
                      <span className="player-online offline">
                        Waiting to join
                      </span>
                    </>
                  )}
                </article>
              )
            })}
          </div>

          <div className="dashboard-columns">
            <div className="dashboard-panel">
              <h2><Wallet size={20} /> Money operations</h2>
              <p className="form-description">
                {isHost
                  ? 'Manage player transfers and bank balances.'
                  : 'Transfer money or pay the bank.'}
              </p>

              <div className="operation-tabs">
                <button
                  className={operation === 'transfer' ? 'active' : ''}
                  onClick={() => { setOperation('transfer'); clearMessages() }}
                >
                  <Send size={15} /> Transfer
                </button>
                <button
                  className={operation === 'bank' ? 'active' : ''}
                  onClick={() => { setOperation('bank'); clearMessages() }}
                >
                  <Landmark size={15} /> Pay bank
                </button>
                {isHost && (
                  <button
                    className={operation === 'adjust' ? 'active' : ''}
                    onClick={() => { setOperation('adjust'); clearMessages() }}
                  >
                    <Settings2 size={15} /> Adjust
                  </button>
                )}
              </div>

              {operation === 'transfer' && (
                <form onSubmit={handleTransfer}>
                  <label>
                    SEND TO
                    <select
                      value={targetPlayer}
                      onChange={(e) => setTargetPlayer(e.target.value)}
                      required
                    >
                      <option value="">Select player</option>
                      {availableRecipients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    AMOUNT
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Enter amount"
                      required
                    />
                  </label>

                  <label>
                    NOTE (OPTIONAL)
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Reason for transfer"
                      maxLength={120}
                    />
                  </label>

                  <button className="submit-button" disabled={loading}>
                    <ArrowUpRight size={17} />
                    {loading ? 'PROCESSING...' : 'SEND MONEY'}
                  </button>
                </form>
              )}

              {operation === 'bank' && (
                <form onSubmit={handleBankPayment}>
                  <p className="form-description">
                    Pay tax, fees or other charges to the unlimited bank.
                  </p>

                  <label>
                    AMOUNT
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Enter amount"
                      required
                    />
                  </label>

                  <label>
                    PAYMENT NOTE
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Income tax"
                      maxLength={120}
                    />
                  </label>

                  <button className="submit-button" disabled={loading}>
                    <ArrowDownLeft size={17} />
                    {loading ? 'PROCESSING...' : 'PAY BANK'}
                  </button>
                </form>
              )}

              {operation === 'adjust' && isHost && (
                <form onSubmit={handleHostAdjustment}>
                  <p className="form-description">
                    Positive amount adds money. Negative amount deducts money.
                  </p>

                  <label>
                    SELECT PLAYER
                    <select
                      value={adjustPlayer}
                      onChange={(e) => setAdjustPlayer(e.target.value)}
                      required
                    >
                      <option value="">Select player</option>
                      {players.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    ADJUSTMENT AMOUNT
                    <input
                      type="number"
                      step="1"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      placeholder="e.g. 500 or -200"
                      required
                    />
                  </label>

                  <label>
                    REASON
                    <input
                      value={adjustNote}
                      onChange={(e) => setAdjustNote(e.target.value)}
                      placeholder="Reason for adjustment"
                      maxLength={120}
                    />
                  </label>

                  <button className="submit-button" disabled={loading}>
                    <Coins size={17} />
                    {loading ? 'PROCESSING...' : 'UPDATE BALANCE'}
                  </button>
                </form>
              )}
            </div>

            {isHost && (
              <div className="dashboard-panel">
                <h2><Settings2 size={20} /> Host controls</h2>
                <p className="form-description">
                  Only the host can control the game.
                </p>

                <div className="host-controls">
                  {gameStatus === 'waiting' && (
                    <button
                      className="control-button primary-control"
                      onClick={() => changeGameStatus('active')}
                      disabled={loading || players.length !== 3}
                    >
                      <Play size={17} /> Start game
                    </button>
                  )}

                  {gameStatus === 'active' && (
                    <button
                      className="control-button"
                      onClick={() => changeGameStatus('paused')}
                      disabled={loading}
                    >
                      <Pause size={17} /> Pause game
                    </button>
                  )}

                  {gameStatus === 'paused' && (
                    <button
                      className="control-button primary-control"
                      onClick={() => changeGameStatus('active')}
                      disabled={loading}
                    >
                      <Play size={17} /> Resume game
                    </button>
                  )}

                  {gameStatus !== 'ended' && (
                    <button
                      className="control-button danger-control"
                      onClick={() => changeGameStatus('ended')}
                      disabled={loading}
                    >
                      End game
                    </button>
                  )}

                  <button
                    className="control-button"
                    onClick={resetGame}
                    disabled={loading}
                  >
                    <RotateCcw size={17} /> Reset balances
                  </button>
                </div>

                {players.length !== 3 && gameStatus === 'waiting' && (
                  <p className="form-description">
                    All three players must join before starting.
                  </p>
                )}

                {gameStatus === 'ended' && (
                  <p className="form-description">
                    This game has ended. Resetting balances does not reopen an ended room.
                  </p>
                )}
              </div>
            )}

            {!isHost && (
              <div className="dashboard-panel">
                <h2><ShieldCheck size={20} /> Your account</h2>
                <p className="form-description">
                  Your role is Player. You can transfer money to other players
                  and pay the bank. The host manages bank credits and game controls.
                </p>
                <div className="account-balance">
                  <span>YOUR CURRENT BALANCE</span>
                  <strong>RM {money(currentPlayer?.balance)}</strong>
                </div>
              </div>
            )}
          </div>

          <div className="dashboard-panel history-panel">
            <div className="history-heading">
              <h2><History size={20} /> Transaction history</h2>
              <span>{visibleTransactions.length} records</span>
            </div>

            {!isHost && (
              <p className="form-description">
                Showing transactions involving your account.
              </p>
            )}

            {visibleTransactions.length === 0 ? (
              <div className="empty-history">
                <Banknote size={30} />
                <p>No transactions yet.</p>
              </div>
            ) : (
              <div className="transaction-list">
                {visibleTransactions.map((t) => {
                  const change = playerBalanceChange(t)

                  return (
                    <div className="transaction-row" key={t.id}>
                      <div className="transaction-icon">
                        {t.transaction_type === 'bank_payment'
                          ? <Landmark size={18} />
                          : t.transaction_type === 'transfer'
                            ? <Send size={18} />
                            : <Coins size={18} />}
                      </div>

                      <div className="transaction-info">
                        <strong>{transactionDescription(t)}</strong>
                        <span>{t.note || t.transaction_type.replaceAll('_', ' ')}</span>
                        <small>{dateTime(t.created_at)}</small>
                      </div>

                      <div className={`transaction-amount ${change < 0 ? 'negative' : 'positive'}`}>
                        {change === null
                          ? `RM ${money(t.amount)}`
                          : `${change > 0 ? '+' : '-'} RM ${money(Math.abs(change))}`}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="dashboard-bottom">
            <span><LockKeyhole size={14} /> Secured by Supabase</span>
            <span>Starting balance: RM {money(room?.starting_balance)}</span>
          </div>
        </section>
      )}

      <footer className="footer">
        <div className="footer-brand">
          <Landmark size={17} /> MONOPOLY BANK
        </div>
        <span>PRIVATE MULTIPLAYER BANKING</span>
        <span><LockKeyhole size={13} /> SECURE GAME ACCESS</span>
      </footer>
    </main>
  )
}

export default App
