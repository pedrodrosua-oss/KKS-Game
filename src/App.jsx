import React, { useEffect, useMemo, useState } from 'react'
import raw from './kks_quiz_data.json'

// -----------------------------
// Utilidades / Storage
// -----------------------------
const LS_PROGRESS = 'kks_quiz_progress_v1'
const LS_SCORES = 'kks_quiz_scores_v1'
const now = () => Date.now()

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)) }

function loadJSON(key, fallback){
  try {
    const v = JSON.parse(localStorage.getItem(key) || '')
    return (v && typeof v === 'object') ? v : fallback
  } catch { return fallback }
}
function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value))
}

function shuffle(arr){
  const a = arr.slice()
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1))
    ;[a[i],a[j]]=[a[j],a[i]]
  }
  return a
}

function pickN(arr, n){
  if (arr.length <= n) return shuffle(arr)
  return shuffle(arr).slice(0,n)
}

// Progreso estilo Leitner (0..4)
function boxLabel(b){
  return ['Nuevo','Caja 1','Caja 2','Caja 3','Dominado'][clamp(b,0,4)]
}
function nextDueMs(box){
  const H = 60*60*1000
  const D = 24*H
  return [0, 4*H, 1*D, 3*D, 14*D][clamp(box,0,4)]
}

// -----------------------------
// KKS helpers
// -----------------------------
// Solo caracteres típicos de KKS + separadores (ajústalo si tu norma es más estricta)
function toKKSOnly(str){
  const s = (str ?? '').toString().toUpperCase()
  // Permitimos: A-Z 0-9 espacio y / . - _ : (muy típico en tags)
  return s.replace(/[^A-Z0-9\/\.\-\_\:\s]/g, '').replace(/\s+/g, ' ').trim()
}

function getQuestionText(card, questionType){
  if (questionType === 'kks_to_es') return card.prompt
  // ES -> KKS: la pregunta es el español, pero si quieres “solo KKS en la pregunta”
  // NO tendría sentido porque pregunta es español. Tú pediste “si pongo de Español a KKS,
  // solo debe aparecer texto ... unicamente las letras propias del KKS”:
  // lo aplicamos a RESPUESTAS (KKS) y además ocultamos EN. La pregunta sigue siendo español.
  return card.answer
}

function getChoiceLabel(card, questionType){
  if (questionType === 'kks_to_es') return card.answer
  // ES -> KKS: solo KKS
  return toKKSOnly(card.prompt)
}

// Genera opciones garantizando:
// - 1 correcta
// - sin duplicados (especialmente en ES->KKS, donde varios cards podrían tener mismo prompt)
// - opciones del mismo category cuando se pueda, para calidad
function makeChoicesUnique(correct, pool, questionType, n=4){
  const correctKey = (questionType === 'es_to_kks')
    ? toKKSOnly(correct.prompt)
    : correct.id

  const seenKeys = new Set([correctKey])

  const candidates = pool
    .filter(x => x.id !== correct.id)
    .map(x => {
      const key = (questionType === 'es_to_kks') ? toKKSOnly(x.prompt) : x.id
      return { card: x, key }
    })
    .filter(x => x.key && !seenKeys.has(x.key))

  // Vamos llenando hasta n-1
  const picked = []
  for (const item of shuffle(candidates)){
    if (picked.length >= n-1) break
    if (seenKeys.has(item.key)) continue
    seenKeys.add(item.key)
    picked.push(item.card)
  }

  // fallback: si por algún motivo faltan distractores, rellenamos con lo que haya
  while (picked.length < n-1 && pool.length > picked.length + 1){
    const r = pool[Math.floor(Math.random()*pool.length)]
    if (!r || r.id === correct.id) continue
    const k = (questionType === 'es_to_kks') ? toKKSOnly(r.prompt) : r.id
    if (!k || seenKeys.has(k)) continue
    seenKeys.add(k)
    picked.push(r)
  }

  return shuffle([correct, ...picked]).slice(0, n)
}

// -----------------------------
// UI
// -----------------------------
const Card = ({children, style}) => (
  <div style={{
    background:'rgba(255,255,255,0.06)',
    border:'1px solid rgba(255,255,255,0.10)',
    borderRadius:16,
    padding:16,
    boxShadow:'0 12px 30px rgba(0,0,0,0.25)',
    ...style
  }}>{children}</div>
)

const Btn = ({children, onClick, disabled, kind='primary', style}) => (
  <button disabled={disabled} onClick={onClick} style={{
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    borderRadius:12,
    border:'1px solid rgba(255,255,255,0.14)',
    padding:'10px 12px',
    background: kind==='primary' ? 'linear-gradient(180deg,#0b5cff,#0636a3)' : 'rgba(255,255,255,0.06)',
    color:'#fff',
    fontWeight:700,
    ...style
  }}>{children}</button>
)

const Chip = ({children, style}) => (
  <span style={{
    display:'inline-flex',
    alignItems:'center',
    gap:8,
    padding:'6px 10px',
    borderRadius:999,
    background:'rgba(255,255,255,0.08)',
    border:'1px solid rgba(255,255,255,0.10)',
    fontSize:12,
    ...style
  }}>{children}</span>
)

function scoreToGrade0to10(score, total){
  if (!total) return 0
  const pct = score / total
  return Math.round(pct * 10 * 10) / 10 // 1 decimal
}

function makeScoreKey({mode, questionType, selectedCats}){
  const cats = Array.from(selectedCats || []).slice().sort().join('|') || 'ALL'
  return `${mode}::${questionType}::${cats}`
}

// -----------------------------
// App
// -----------------------------
export default function App(){
  // Normaliza tarjetas desde el JSON
  const cards = useMemo(() => {
    const list = raw.cards || []
    const normalized = list.map((c, i) => {
      const q = (c?.q ?? '').toString().trim()
      const a = (c?.a ?? '').toString().trim()
      const en = (c?.en ?? '').toString().trim()
      const sheet = (c?.sheet ?? '').toString().trim()
      const nivel = (c?.nivel ?? '').toString().trim()
      const type = (c?.type ?? '').toString().trim()

      let kks = ''
      const m1 = q.match(/significa\s+([^?¿]+)\?/i)
      if (m1?.[1]) kks = m1[1].trim()
      else kks = q.replace(/^¿?\s*Qué\s+significa\s+/i, '').replace(/\?$/, '').trim()
      if (!kks) kks = q

      const category = sheet || nivel || type || 'General'

      return {
        id: `${category}-${kks}-${i}`,
        category,
        sheet,
        nivel,
        type,
        prompt: kks,    // KKS
        answer: a,      // Español
        es: a,
        en,
        extra: q
      }
    })

    return normalized
      .filter(c => c.prompt && c.answer)
      .map(c => ({...c, prompt: c.prompt.trim(), answer: c.answer.trim()}))
  }, [])

  const categories = useMemo(() => {
    const set = new Set(cards.map(c => c.category))
    return Array.from(set).sort()
  }, [cards])

  // -----------------------------
  // Settings
  // -----------------------------
  // mode:
  // - session: sin repetición, con nota final y guardado de score
  // - exam100: 100 preguntas mixtas (kks/es aleatorio) sin elegir categoría
  // - flash: flashcards
  const [mode, setMode] = useState('session') // session | exam100 | flash
  const [difficulty, setDifficulty] = useState('mix') // new | due | mix (solo aplica en session/flash)
  const [questionType, setQuestionType] = useState('kks_to_es') // kks_to_es | es_to_kks (session/flash)
  const [showEN, setShowEN] = useState(true)

  const [selectedCats, setSelectedCats] = useState(() => new Set(categories.length ? categories : ['General']))

  // storage
  const [progress, setProgress] = useState(() => loadJSON(LS_PROGRESS, {}))
  const [scores, setScores] = useState(() => loadJSON(LS_SCORES, {}))
  useEffect(() => { saveJSON(LS_PROGRESS, progress) }, [progress])
  useEffect(() => { saveJSON(LS_SCORES, scores) }, [scores])

  // Ajustes automáticos:
  // En ES->KKS: ocultar EN (para que no "contamine")
  const effectiveShowEN = (questionType === 'es_to_kks' && mode !== 'exam100') ? false : showEN

  // -----------------------------
  // Pool base según filtros
  // -----------------------------
  const filteredCards = useMemo(() => {
    if (mode === 'exam100') return cards
    const cats = selectedCats
    return cards.filter(c => cats.has(c.category))
  }, [cards, selectedCats, mode])

  const pool = useMemo(() => {
    // adjunta progreso
    const withP = filteredCards.map(c => {
      const p = progress[c.id] || { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 }
      return {...c, _p: p}
    })

    if (mode === 'exam100') return withP // aquí luego creamos examen aparte

    const t = now()
    if (difficulty === 'new') return withP.filter(c => (c._p.seen||0) === 0)
    if (difficulty === 'due') return withP.filter(c => (c._p.due||0) <= t)

    // mix
    const due = withP.filter(c => (c._p.due||0) <= t)
    const fresh = withP.filter(c => (c._p.seen||0) === 0)
    const rest = withP.filter(c => (c._p.due||0) > t && (c._p.seen||0) > 0)
    return [...shuffle(due), ...shuffle(fresh), ...shuffle(rest)]
  }, [filteredCards, progress, difficulty, mode])

  // -----------------------------
  // Construcción de sesión/examen SIN REPETICIÓN
  // -----------------------------
  const [sessionOrder, setSessionOrder] = useState([])
  const [idx, setIdx] = useState(0)

  // Marcador de sesión
  const [sessionCorrect, setSessionCorrect] = useState(0)
  const [sessionWrong, setSessionWrong] = useState(0)

  // Estado de pregunta
  const [choices, setChoices] = useState([])
  const [picked, setPicked] = useState(null)
  const [reveal, setReveal] = useState(false)
  const [feedback, setFeedback] = useState(null) // { type:'ok'|'bad', text:string }

  // En examen: dirección por pregunta (mixto)
  const [examDir, setExamDir] = useState('kks_to_es')

  // Reseteos cuando cambias settings
  useEffect(() => {
    // Reinicia sesión/examen
    setIdx(0)
    setPicked(null)
    setReveal(false)
    setFeedback(null)
    setSessionCorrect(0)
    setSessionWrong(0)

    if (mode === 'exam100'){
      const order = shuffle(cards).slice(0, Math.min(100, cards.length))
      setSessionOrder(order)
      setExamDir(Math.random() < 0.5 ? 'kks_to_es' : 'es_to_kks')
    } else {
      // session / flash
      const order = shuffle(pool) // pool ya viene priorizado según difficulty
      setSessionOrder(order)
    }
  }, [mode, difficulty, questionType, selectedCats, cards, pool])

  const current = useMemo(() => {
    if (!sessionOrder.length) return null
    return sessionOrder[idx] || null
  }, [sessionOrder, idx])

  // Crear choices al entrar a una pregunta
  useEffect(() => {
    setPicked(null)
    setReveal(false)
    setFeedback(null)
    setChoices([])

    if (!current) return

    const qType = (mode === 'exam100') ? examDir : questionType

    // pool de distractores del mismo category cuando se pueda
    const sameCat = cards.filter(c => c.category === current.category)
    const basePool = sameCat.length >= 4 ? sameCat : cards

    setChoices(makeChoicesUnique(current, basePool, qType, 4))
  }, [current, cards, questionType, mode, examDir])

  // -----------------------------
  // Estadísticas globales (Leitner)
  // -----------------------------
  const globalStats = useMemo(() => {
    const p = progress
    const ids = cards.map(c => c.id)
    let seen=0, correct=0, wrong=0, mastered=0, due=0
    const t=now()
    for (const id of ids){
      const s = p[id]
      if (!s) continue
      if ((s.seen||0)>0) seen++
      correct += (s.correct||0)
      wrong += (s.wrong||0)
      if ((s.box||0) >= 4) mastered++
      if ((s.due||0) <= t) due++
    }
    return { total: ids.length, seen, correct, wrong, mastered, due }
  }, [progress, cards])

  // -----------------------------
  // Guardar progreso estilo Leitner
  // -----------------------------
  function markResult(isCorrect){
    if (!current) return
    const prev = progress[current.id] || { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 }
    const seen = (prev.seen||0)+1
    let box = prev.box || 0
    let correct = prev.correct||0
    let wrong = prev.wrong||0

    if (isCorrect){
      correct += 1
      box = clamp(box + 1, 0, 4)
    } else {
      wrong += 1
      box = clamp(box - 1, 0, 4)
    }

    const due = now() + nextDueMs(box)
    const next = { box, due, seen, correct, wrong }
    setProgress(p => ({...p, [current.id]: next}))
  }

  function recordScoreAndFinish(){
    const total = sessionOrder.length
    const grade = scoreToGrade0to10(sessionCorrect, total)
    const qType = (mode === 'exam100') ? 'mixed' : questionType
    const key = (mode === 'exam100')
      ? `exam100::mixed::ALL`
      : makeScoreKey({mode:'session', questionType:qType, selectedCats})

    setScores(prev => {
      const old = prev[key] || { best: 0, last: 0, attempts: 0, updatedAt: 0 }
      const best = Math.max(old.best || 0, grade)
      return {
        ...prev,
        [key]: { best, last: grade, attempts: (old.attempts||0)+1, updatedAt: now() }
      }
    })
  }

  function nextQuestion(){
    // en flash: siempre puede avanzar
    if (mode !== 'flash'){
      // en session/exam: si no respondió, no debería avanzar (mantengo simple)
      if (!reveal) return
    }

    const isLast = idx >= sessionOrder.length - 1
    if (isLast){
      // guarda score
      if (mode === 'session' || mode === 'exam100'){
        recordScoreAndFinish()
      }
      return
    }

    setIdx(i => i+1)
    if (mode === 'exam100'){
      setExamDir(Math.random() < 0.5 ? 'kks_to_es' : 'es_to_kks')
    }
  }

  function resetProgress(){
    if (!confirm('¿Seguro? Se borrará tu progreso Leitner.')) return
    setProgress({})
  }

  function resetScores(){
    if (!confirm('¿Seguro? Se borrarán tus notas (mejor/última).')) return
    setScores({})
  }

  function toggleCat(cat){
    setSelectedCats(prev => {
      const n = new Set(prev)
      if (n.has(cat)) n.delete(cat)
      else n.add(cat)
      if (n.size === 0) n.add(cat)
      return n
    })
  }
  function selectAllCats(){ setSelectedCats(new Set(categories)) }
  function selectNoneCats(){ setSelectedCats(new Set([categories[0]])) }

  // -----------------------------
  // Render helpers
  // -----------------------------
  const isFinished = !!sessionOrder.length && idx >= sessionOrder.length - 1 && reveal

  const currentQType = (mode === 'exam100') ? examDir : questionType

  const scoreKey = (mode === 'exam100')
    ? `exam100::mixed::ALL`
    : makeScoreKey({mode:'session', questionType: currentQType, selectedCats})

  const scoreRec = scores[scoreKey]

  const totalQuestions = sessionOrder.length
  const answered = sessionCorrect + sessionWrong
  const gradeNow = scoreToGrade0to10(sessionCorrect, Math.max(1, answered))

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div style={{maxWidth:980, margin:'0 auto', padding:16}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:22, fontWeight:900}}>KKS Quiz</div>
          <div style={{opacity:0.85, fontSize:13}}>
            Sesiones sin repetición, feedback claro y modo examen 100.
          </div>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <Chip>Total: {globalStats.total}</Chip>
          <Chip>Vistos: {globalStats.seen}</Chip>
          <Chip>Dominados: {globalStats.mastered}</Chip>
          <Chip>Vencidos: {globalStats.due}</Chip>
          <Btn kind="ghost" onClick={resetProgress}>Reset Leitner</Btn>
          <Btn kind="ghost" onClick={resetScores}>Reset notas</Btn>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12, marginTop:12}}>
        <Card>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10}}>
            <label>
              <div style={{fontSize:12, opacity:0.9}}>Modo</div>
              <select value={mode} onChange={e=>setMode(e.target.value)} style={{width:'100%', padding:10, borderRadius:12}}>
                <option value="session">Sesión (sin repetir, con nota)</option>
                <option value="exam100">Examen definitivo (100, mixto)</option>
                <option value="flash">Flashcards</option>
              </select>
            </label>

            <label>
              <div style={{fontSize:12, opacity:0.9}}>Enfoque</div>
              <select disabled={mode==='exam100'} value={difficulty} onChange={e=>setDifficulty(e.target.value)} style={{width:'100%', padding:10, borderRadius:12, opacity: mode==='exam100' ? 0.6 : 1}}>
                <option value="mix">Mezcla (vencidos + nuevos)</option>
                <option value="due">Solo vencidos (repaso)</option>
                <option value="new">Solo nuevos</option>
              </select>
            </label>

            <label>
              <div style={{fontSize:12, opacity:0.9}}>Dirección</div>
              <select disabled={mode==='exam100'} value={questionType} onChange={e=>setQuestionType(e.target.value)} style={{width:'100%', padding:10, borderRadius:12, opacity: mode==='exam100' ? 0.6 : 1}}>
                <option value="kks_to_es">KKS → Español</option>
                <option value="es_to_kks">Español → KKS</option>
              </select>
            </label>

            <label style={{display:'flex', alignItems:'flex-end', gap:8, opacity: (mode==='exam100' || questionType==='es_to_kks') ? 0.6 : 1}}>
              <input
                type="checkbox"
                checked={showEN}
                disabled={mode==='exam100' || questionType==='es_to_kks'}
                onChange={e=>setShowEN(e.target.checked)}
              />
              <span style={{fontSize:13, opacity:0.9}}>Mostrar inglés (EN)</span>
            </label>
          </div>

          {mode !== 'exam100' && (
            <div style={{marginTop:12}}>
              <div style={{fontSize:12, opacity:0.9, marginBottom:8}}>Categorías (elige las que quieras)</div>
              <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
                {categories.map(cat => (
                  <button key={cat} onClick={()=>toggleCat(cat)} style={{
                    cursor:'pointer',
                    padding:'8px 10px',
                    borderRadius:999,
                    border:'1px solid rgba(255,255,255,0.12)',
                    background: selectedCats.has(cat) ? 'rgba(11,92,255,0.45)' : 'rgba(255,255,255,0.06)',
                    color:'#fff',
                    fontWeight:700
                  }}>{cat}</button>
                ))}
                <Btn kind="ghost" onClick={selectAllCats} style={{padding:'8px 10px'}}>Todo</Btn>
                <Btn kind="ghost" onClick={selectNoneCats} style={{padding:'8px 10px'}}>Mínimo</Btn>
              </div>
            </div>
          )}

          <div style={{marginTop:12, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
            <Chip style={{background:'rgba(34,197,94,0.15)'}}>Aciertos: {sessionCorrect}</Chip>
            <Chip style={{background:'rgba(239,68,68,0.15)'}}>Fallos: {sessionWrong}</Chip>
            <Chip>Respondidas: {answered}/{totalQuestions || 0}</Chip>
            <Chip>Nota (parcial): {gradeNow}/10</Chip>
            {scoreRec ? (
              <Chip>Mejor: {scoreRec.best}/10 · Última: {scoreRec.last}/10 · Intentos: {scoreRec.attempts}</Chip>
            ) : (
              <Chip>Sin nota guardada todavía</Chip>
            )}
          </div>
        </Card>

        <Card>
          {!current ? (
            <div>No hay tarjetas en el pool (revisa filtros).</div>
          ) : (
            <>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  <Chip>Categoría: {current.category}</Chip>
                  {current.sheet ? <Chip>Hoja: {current.sheet}</Chip> : null}
                  <Chip>Progreso: {boxLabel(current._p?.box||0)}</Chip>
                  <Chip>Dirección: {mode==='exam100' ? (examDir==='kks_to_es'?'KKS→ES':'ES→KKS') : (questionType==='kks_to_es'?'KKS→ES':'ES→KKS')}</Chip>
                </div>
                <Chip>{idx+1} / {sessionOrder.length || 0}</Chip>
              </div>

              <div style={{marginTop:12, fontSize:18, fontWeight:900}}>
                {getQuestionText(current, currentQType)}
              </div>

              {effectiveShowEN && current.en ? (
                <div style={{marginTop:6, opacity:0.85}}>
                  <span style={{fontSize:12, opacity:0.8}}>EN: </span>{current.en}
                </div>
              ) : null}

              {mode === 'flash' ? (
                <div style={{marginTop:14}}>
                  <Btn onClick={() => setReveal(true)} disabled={reveal}>Revelar respuesta</Btn>
                  {reveal ? (
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:14, opacity:0.9}}>Respuesta</div>
                      <div style={{fontSize:18, fontWeight:900}}>
                        {currentQType === 'kks_to_es' ? current.answer : toKKSOnly(current.prompt)}
                      </div>
                      <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}}>
                        <Btn onClick={() => { markResult(true); setSessionCorrect(x=>x+1); setFeedback({type:'ok', text:'¡Correcto!'}); }} style={{background:'linear-gradient(180deg,#22c55e,#15803d)'}}>La sabía</Btn>
                        <Btn onClick={() => { markResult(false); setSessionWrong(x=>x+1); setFeedback({type:'bad', text:'Apuntado como fallo.'}); }} style={{background:'linear-gradient(180deg,#ef4444,#991b1b)'}}>Fallé</Btn>
                        <Btn onClick={nextQuestion} style={{background:'linear-gradient(180deg,#22c55e,#15803d)'}}>Siguiente pregunta</Btn>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div style={{marginTop:14, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10}}>
                    {choices.map(choice => {
                      const label = getChoiceLabel(choice, currentQType)
                      const isCorrect = choice.id === current.id
                      const isPicked = picked?.id === choice.id

                      let bg = 'rgba(255,255,255,0.06)'
                      if (reveal && isCorrect) bg = 'rgba(34,197,94,0.35)'       // verde correcto
                      if (reveal && isPicked && !isCorrect) bg = 'rgba(239,68,68,0.35)' // rojo error

                      return (
                        <button key={choice.id} onClick={() => {
                          if (reveal) return
                          setPicked(choice)
                          setReveal(true)

                          const ok = isCorrect
                          markResult(ok)

                          if (ok){
                            setSessionCorrect(x => x+1)
                            setFeedback({type:'ok', text:'✅ ¡Correcto!'})
                          } else {
                            setSessionWrong(x => x+1)
                            const correctLabel = getChoiceLabel(current, currentQType)
                            setFeedback({type:'bad', text:`❌ Error. La respuesta correcta era: ${correctLabel}`})
                          }
                        }} style={{
                          cursor: reveal ? 'default' : 'pointer',
                          textAlign:'left',
                          padding:12,
                          borderRadius:14,
                          border:'1px solid rgba(255,255,255,0.12)',
                          background: bg,
                          color:'#fff'
                        }}>
                          <div style={{fontWeight:900}}>{label}</div>
                          {effectiveShowEN && currentQType==='kks_to_es' && choice.en ? (
                            <div style={{marginTop:4, fontSize:12, opacity:0.8}}>EN: {choice.en}</div>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>

                  {feedback ? (
                    <div style={{
                      marginTop:12,
                      padding:12,
                      borderRadius:12,
                      border:'1px solid rgba(255,255,255,0.14)',
                      background: feedback.type==='ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                      fontWeight:800
                    }}>
                      {feedback.text}
                    </div>
                  ) : null}

                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginTop:16, flexWrap:'wrap'}}>
                    <div style={{display:'flex', gap:8}}>
                      <Btn kind="ghost" onClick={() => setIdx(i => Math.max(0, i-1))} disabled={idx===0}>◀ Anterior</Btn>
                      <Btn
                        onClick={nextQuestion}
                        disabled={!reveal}
                        style={{background:'linear-gradient(180deg,#22c55e,#15803d)'}}
                      >
                        Siguiente pregunta ▶
                      </Btn>
                    </div>
                    <div style={{fontSize:12, opacity:0.8}}>
                      Tip: instala como app (Android/iOS): menú del navegador → “Añadir a pantalla de inicio”.
                    </div>
                  </div>

                  {/* Pantalla final de sesión */}
                  {isFinished ? (
                    <div style={{
                      marginTop:14,
                      padding:14,
                      borderRadius:14,
                      border:'1px solid rgba(255,255,255,0.14)',
                      background:'rgba(255,255,255,0.06)'
                    }}>
                      <div style={{fontWeight:900, fontSize:16}}>Fin de {mode === 'exam100' ? 'examen' : 'sesión'} 🎉</div>
                      <div style={{marginTop:8, opacity:0.9}}>
                        Aciertos: <b>{sessionCorrect}</b> · Fallos: <b>{sessionWrong}</b> · Total: <b>{totalQuestions}</b>
                      </div>
                      <div style={{marginTop:6, opacity:0.9}}>
                        Nota final: <b>{scoreToGrade0to10(sessionCorrect, totalQuestions)}/10</b>
                      </div>
                      <div style={{marginTop:10, display:'flex', gap:8, flexWrap:'wrap'}}>
                        <Btn onClick={() => {
                          // reiniciar sesión actual
                          setIdx(0)
                          setSessionCorrect(0)
                          setSessionWrong(0)
                          setPicked(null)
                          setReveal(false)
                          setFeedback(null)

                          if (mode === 'exam100'){
                            const order = shuffle(cards).slice(0, Math.min(100, cards.length))
                            setSessionOrder(order)
                            setExamDir(Math.random() < 0.5 ? 'kks_to_es' : 'es_to_kks')
                          } else {
                            setSessionOrder(shuffle(pool))
                          }
                        }} style={{background:'linear-gradient(180deg,#0b5cff,#0636a3)'}}>
                          Repetir
                        </Btn>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </Card>

        <Card>
          <div style={{fontWeight:900}}>Banco de datos</div>
          <div style={{opacity:0.85, fontSize:13, marginTop:6}}>
            Archivo actual: <code style={{opacity:0.9}}>src/kks_quiz_data.json</code>
          </div>
        </Card>
      </div>

      <div style={{marginTop:14, opacity:0.7, fontSize:12}}>
        Progreso y notas guardados en tu dispositivo (localStorage).
      </div>
    </div>
  )
}
