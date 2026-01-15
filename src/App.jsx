import React, { useEffect, useMemo, useRef, useState } from 'react'
import raw from './kks_quiz_data.json'

// -----------------------------
// Utilidades
// -----------------------------
const LS_KEY = 'kks_quiz_progress_v1'
const now = () => Date.now()

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)) }

function loadProgress(){
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}

function saveProgress(p){
  localStorage.setItem(LS_KEY, JSON.stringify(p))
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

function makeChoices(correct, pool, n=4){
  const others = pool.filter(x => x.id !== correct.id)
  const picked = pickN(others, n-1)
  const choices = shuffle([correct, ...picked])
  return choices
}

// Progreso estilo Leitner (0..4)
function boxLabel(b){
  return ['Nuevo','Caja 1','Caja 2','Caja 3','Dominado'][clamp(b,0,4)]
}

function nextDueMs(box){
  // intervalos sencillos: 0=ahora, 1=4h, 2=1d, 3=3d, 4=14d
  const H = 60*60*1000
  const D = 24*H
  return [0, 4*H, 1*D, 3*D, 14*D][clamp(box,0,4)]
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
    fontWeight:600,
    ...style
  }}>{children}</button>
)

const Chip = ({children}) => (
  <span style={{
    display:'inline-flex',
    alignItems:'center',
    gap:8,
    padding:'6px 10px',
    borderRadius:999,
    background:'rgba(255,255,255,0.08)',
    border:'1px solid rgba(255,255,255,0.10)',
    fontSize:12
  }}>{children}</span>
)

// -----------------------------
// App
// -----------------------------
export default function App(){
  // Normaliza tarjetas desde el JSON generado
  const cards = useMemo(() => {
    const list = raw.cards || []

    // Tu JSON trae cartas con formato:
    // { type, q, a, sheet, nivel, en }
    // q = "¿Qué significa AD?"  -> AD es el KKS
    // a = "Sistemas 220–245 kV" -> Español/Descripción
    // Vamos a normalizarlo al formato que usa la app:
    // { id, category, sheet, prompt (KKS), answer (ES), en, extra }

    const normalized = list.map((c, i) => {
      const q = (c?.q ?? '').toString().trim()
      const a = (c?.a ?? '').toString().trim()
      const en = (c?.en ?? '').toString().trim()
      const sheet = (c?.sheet ?? '').toString().trim()
      const nivel = (c?.nivel ?? '').toString().trim()
      const type = (c?.type ?? '').toString().trim()

      // Extrae el código KKS del texto "¿Qué significa XX?"
      // Si no matchea, usa q como fallback.
      let kks = ''
      const m1 = q.match(/significa\s+([^?¿]+)\?/i)
      if (m1?.[1]) kks = m1[1].trim()
      else {
        // fallback simple
        kks = q.replace(/^¿?\s*Qué\s+significa\s+/i, '').replace(/\?$/, '').trim()
      }
      if (!kks) kks = q

      const category = sheet || nivel || type || 'General'

      return {
        id: `${category}-${kks}-${i}`,
        category,
        sheet,
        nivel,
        type,
        prompt: kks,    // KKS
        answer: a,      // Español / descripción
        es: a,
        en,
        extra: q
      }
    })

    // Filtra cartas rotas
    return normalized.filter(c => c.prompt && c.answer)
  }, [])


  const categories = useMemo(() => {
    const set = new Set(cards.map(c => c.category))
    return Array.from(set).sort()
  }, [cards])

  const [mode, setMode] = useState('test') // test | flash
  const [selectedCats, setSelectedCats] = useState(() => new Set(categories))
  const [difficulty, setDifficulty] = useState('mix') // new | due | mix
  const [questionType, setQuestionType] = useState('kks_to_es') // kks_to_es | es_to_kks
  const [showEN, setShowEN] = useState(true)
  const [progress, setProgress] = useState(loadProgress)

  useEffect(() => { saveProgress(progress) }, [progress])

  const pool = useMemo(() => {
    const cats = selectedCats
    const filtered = cards.filter(c => cats.has(c.category))

    // adjunta progreso
    const withP = filtered.map(c => {
      const p = progress[c.id] || { box: 0, due: 0, seen: 0, correct: 0, wrong: 0 }
      return {...c, _p: p}
    })

    const t = now()
    if (difficulty === 'new') return withP.filter(c => (c._p.seen||0) === 0)
    if (difficulty === 'due') return withP.filter(c => (c._p.due||0) <= t)
    // mix: prioriza vencidos + nuevos
    const due = withP.filter(c => (c._p.due||0) <= t)
    const fresh = withP.filter(c => (c._p.seen||0) === 0)
    const rest = withP.filter(c => (c._p.due||0) > t && (c._p.seen||0) > 0)
    return [...shuffle(due), ...shuffle(fresh), ...shuffle(rest)]
  }, [cards, selectedCats, progress, difficulty])

  const [idx, setIdx] = useState(0)
  useEffect(() => { setIdx(0) }, [mode, difficulty, questionType, selectedCats])

  const current = pool[idx % Math.max(1,pool.length)]

  // Estado de pregunta
  const [choices, setChoices] = useState([])
  const [reveal, setReveal] = useState(false)
  const [picked, setPicked] = useState(null)

  useEffect(() => {
    setReveal(false)
    setPicked(null)
    if (!current) return

    // Para multiple-choice, elegimos pool de respuestas del mismo category (mejor calidad)
    const sameCat = cards.filter(c => c.category === current.category)
    setChoices(makeChoices(current, sameCat, 4))
  }, [idx, current, cards])

  const stats = useMemo(() => {
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

  function next(){
    setIdx(i => i+1)
  }

  function resetProgress(){
    if (!confirm('¿Seguro? Se borrará tu progreso.')) return
    setProgress({})
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

  // Render
  return (
    <div style={{maxWidth:980, margin:'0 auto', padding:16}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:22, fontWeight:800}}>KKS Quiz</div>
          <div style={{opacity:0.85, fontSize:13}}>Modo prueba-error para aprender codificación KKS (offline/PWA).</div>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <Chip>Total: {stats.total}</Chip>
          <Chip>Vistos: {stats.seen}</Chip>
          <Chip>Dominados: {stats.mastered}</Chip>
          <Chip>Vencidos: {stats.due}</Chip>
          <Btn kind="ghost" onClick={resetProgress}>Reset progreso</Btn>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12, marginTop:12}}>
        <Card>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10}}>
            <label>
              <div style={{fontSize:12, opacity:0.9}}>Modo</div>
              <select value={mode} onChange={e=>setMode(e.target.value)} style={{width:'100%', padding:10, borderRadius:12}}>
                <option value="test">Test (opción múltiple)</option>
                <option value="flash">Flashcards (revelar)</option>
              </select>
            </label>

            <label>
              <div style={{fontSize:12, opacity:0.9}}>Enfoque</div>
              <select value={difficulty} onChange={e=>setDifficulty(e.target.value)} style={{width:'100%', padding:10, borderRadius:12}}>
                <option value="mix">Mezcla (vencidos + nuevos)</option>
                <option value="due">Solo vencidos (repaso)</option>
                <option value="new">Solo nuevos</option>
              </select>
            </label>

            <label>
              <div style={{fontSize:12, opacity:0.9}}>Tipo de pregunta</div>
              <select value={questionType} onChange={e=>setQuestionType(e.target.value)} style={{width:'100%', padding:10, borderRadius:12}}>
                <option value="kks_to_es">KKS → Español</option>
                <option value="es_to_kks">Español → KKS</option>
              </select>
            </label>

            <label style={{display:'flex', alignItems:'flex-end', gap:8}}>
              <input type="checkbox" checked={showEN} onChange={e=>setShowEN(e.target.checked)} />
              <span style={{fontSize:13, opacity:0.9}}>Mostrar inglés (EN)</span>
            </label>
          </div>

          <div style={{marginTop:12}}>
            <div style={{fontSize:12, opacity:0.9, marginBottom:8}}>Categorías (incluye TODO: sistemas, equipos, válvulas, tuberías, componentes…)</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
              {categories.map(cat => (
                <button key={cat} onClick={()=>toggleCat(cat)} style={{
                  cursor:'pointer',
                  padding:'8px 10px',
                  borderRadius:999,
                  border:'1px solid rgba(255,255,255,0.12)',
                  background: selectedCats.has(cat) ? 'rgba(11,92,255,0.45)' : 'rgba(255,255,255,0.06)',
                  color:'#fff'
                }}>{cat}</button>
              ))}
              <Btn kind="ghost" onClick={selectAllCats} style={{padding:'8px 10px'}}>Todo</Btn>
              <Btn kind="ghost" onClick={selectNoneCats} style={{padding:'8px 10px'}}>Mínimo</Btn>
            </div>
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
                </div>
                <Chip>{idx+1} / {pool.length || 0}</Chip>
              </div>

              <div style={{marginTop:12, fontSize:18, fontWeight:800}}>
                {questionType === 'kks_to_es' ? current.prompt : current.answer}
              </div>
              {showEN && current.en ? (
                <div style={{marginTop:6, opacity:0.85}}>
                  <span style={{fontSize:12, opacity:0.8}}>EN: </span>{current.en}
                </div>
              ) : null}

              {mode === 'test' ? (
                <div style={{marginTop:14, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:10}}>
                  {choices.map(choice => {
                    const label = questionType === 'kks_to_es' ? choice.answer : choice.prompt
                    const isCorrect = choice.id === current.id
                    const isPicked = picked?.id === choice.id
                    let bg = 'rgba(255,255,255,0.06)'
                    if (reveal && isCorrect) bg = 'rgba(34,197,94,0.35)'
                    if (reveal && isPicked && !isCorrect) bg = 'rgba(239,68,68,0.35)'

                    return (
                      <button key={choice.id} onClick={() => {
                        if (reveal) return
                        setPicked(choice)
                        setReveal(true)
                        markResult(isCorrect)
                      }} style={{
                        cursor: reveal ? 'default' : 'pointer',
                        textAlign:'left',
                        padding:12,
                        borderRadius:14,
                        border:'1px solid rgba(255,255,255,0.12)',
                        background: bg,
                        color:'#fff'
                      }}>
                        <div style={{fontWeight:700}}>{label}</div>
                        {showEN && choice.en ? <div style={{marginTop:4, fontSize:12, opacity:0.8}}>EN: {choice.en}</div> : null}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div style={{marginTop:14}}>
                  <Btn onClick={() => setReveal(true)} disabled={reveal}>Revelar respuesta</Btn>
                  {reveal ? (
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:14, opacity:0.9}}>Respuesta</div>
                      <div style={{fontSize:18, fontWeight:800}}>
                        {questionType === 'kks_to_es' ? current.answer : current.prompt}
                      </div>
                      <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}}>
                        <Btn onClick={() => { markResult(true); next(); }} style={{background:'linear-gradient(180deg,#22c55e,#15803d)'}}>La sabía</Btn>
                        <Btn onClick={() => { markResult(false); next(); }} style={{background:'linear-gradient(180deg,#ef4444,#991b1b)'}}>Fallé</Btn>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginTop:16, flexWrap:'wrap'}}>
                <div style={{display:'flex', gap:8}}>
                  <Btn kind="ghost" onClick={() => setIdx(i => Math.max(0, i-1))}>◀ Anterior</Btn>
                  <Btn onClick={next}>Siguiente ▶</Btn>
                </div>
                <div style={{fontSize:12, opacity:0.8}}>
                  Tip: instala como app (Android/iOS): menú del navegador → “Añadir a pantalla de inicio”.
                </div>
              </div>
            </>
          )}
        </Card>

        <Card>
          <div style={{fontWeight:800}}>Cargar tu propio banco (opcional)</div>
          <div style={{opacity:0.85, fontSize:13, marginTop:6}}>
            Por defecto viene precargado con el Excel que generamos (convertido a JSON). Si luego amplías el Excel, puedes volver a generar el JSON y reemplazarlo.
          </div>
          <div style={{marginTop:10, opacity:0.85, fontSize:13}}>
            Archivo actual: <code style={{opacity:0.9}}>src/kks_quiz_data.json</code>
          </div>
        </Card>
      </div>

      <div style={{marginTop:14, opacity:0.7, fontSize:12}}>
        Hecho para estudiar KKS por prueba-error. Progreso guardado en tu dispositivo.
      </div>
    </div>
  )
}
