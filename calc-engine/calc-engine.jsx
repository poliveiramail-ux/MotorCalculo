import { useState, useMemo } from "react"

/* ═══════════════════════════════════════════════════════════════
   ENGINE
   ═══════════════════════════════════════════════════════════════ */

const mk = (cid, p, vid, lid, bid) => {
  const parts = [cid, String(p), vid]
  if (lid != null) parts.push(lid)
  if (bid != null) parts.push(bid)
  return parts.join("·")
}

const prevP = p => (p % 100 === 1) ? (Math.floor(p / 100) - 1) * 100 + 12 : p - 1
const nextP = p => (p % 100 === 12) ? (Math.floor(p / 100) + 1) * 100 + 1 : p + 1

const fmtP = p => {
  const M = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
  return `${M[p % 100 - 1]} ${Math.floor(p / 100)}`
}

const fmtV = v => {
  if (v == null) return null
  if (!isFinite(v) || isNaN(v)) return "ERR"
  return v.toLocaleString("pt-PT", { maximumFractionDigits: 2 })
}

// ── Tokenizer ────────────────────────────────────────────────
function tokenize(s) {
  const ts = []; let i = 0; s = s.trim()
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue }
    if (/\d/.test(s[i])) {
      let n = ""
      while (i < s.length && /[\d.]/.test(s[i])) n += s[i++]
      ts.push({ t: "NUM", v: +n }); continue
    }
    if (/[a-zA-Z_]/.test(s[i])) {
      let w = ""
      while (i < s.length && /\w/.test(s[i])) w += s[i++]
      const kw = { PREV: "PREV", SUM_LOBS: "SL", SUM_LANGS: "SG" }
      ts.push({ t: kw[w] ?? "VAR", v: w }); continue
    }
    const ops = { "+": "+", "-": "-", "*": "*", "/": "/", "(": "(", ")": ")" }
    if (ops[s[i]]) { ts.push({ t: ops[s[i]] }); i++ }
    else throw new Error(`Carácter inválido: '${s[i]}'`)
  }
  return ts
}

// ── Parser ───────────────────────────────────────────────────
class Parser {
  constructor(ts) { this.ts = ts; this.i = 0 }
  pk() { return this.ts[this.i] }
  eat() { return this.ts[this.i++] }
  end() { return this.i >= this.ts.length }
  ex(t) {
    const tk = this.eat()
    if (!tk || tk.t !== t) throw new Error(`Esperado ${t}, obtido ${tk?.t ?? "fim"}`)
    return tk
  }
  mt(...ts) { return ts.includes(this.pk()?.t) }
  parse() {
    if (!this.ts.length) throw new Error("Fórmula vazia")
    const n = this.expr()
    if (!this.end()) throw new Error(`Token inesperado: ${this.pk()?.t}`)
    return n
  }
  expr() {
    let n = this.term()
    while (this.mt("+", "-")) { const op = this.eat().t; n = { t: "Op", op, l: n, r: this.term() } }
    return n
  }
  term() {
    let n = this.factor()
    while (this.mt("*", "/")) { const op = this.eat().t; n = { t: "Op", op, l: n, r: this.factor() } }
    return n
  }
  factor() {
    const tk = this.pk()
    if (!tk) throw new Error("Expressão incompleta")
    if (tk.t === "NUM") { this.eat(); return { t: "Lit", v: tk.v } }
    if (tk.t === "(")   { this.eat(); const e = this.expr(); this.ex(")"); return e }
    if (tk.t === "PREV") { this.eat(); this.ex("("); const v = this.ex("VAR").v; this.ex(")"); return { t: "Prev", id: v } }
    if (tk.t === "SL")   { this.eat(); this.ex("("); const v = this.ex("VAR").v; this.ex(")"); return { t: "SumL", id: v } }
    if (tk.t === "SG")   { this.eat(); this.ex("("); const v = this.ex("VAR").v; this.ex(")"); return { t: "SumG", id: v } }
    if (tk.t === "VAR")  { this.eat(); return { t: "Var", id: tk.v } }
    throw new Error(`Token inesperado: ${tk.t}`)
  }
}

const tryParse = f => {
  try { return { ok: true, ast: new Parser(tokenize(f)).parse() } }
  catch (e) { return { ok: false, err: e.message } }
}

const getDeps = n => {
  if (!n) return []
  if (n.t === "Lit")  return []
  if (n.t === "Var")  return [{ k: "d",  id: n.id }]
  if (n.t === "Prev") return [{ k: "pv", id: n.id }]
  if (n.t === "SumL") return [{ k: "sl", id: n.id }]
  if (n.t === "SumG") return [{ k: "sg", id: n.id }]
  if (n.t === "Op")   return [...getDeps(n.l), ...getDeps(n.r)]
  return []
}

// ── Topological Sort (Kahn) ──────────────────────────────────
const topoSort = vs => {
  const ids = new Set(vs.map(v => v.id))
  const adj = {}, ind = {}
  vs.forEach(v => { adj[v.id] = []; ind[v.id] = 0 })
  vs.forEach(v => {
    const fs = [v.formula, ...(v.alternatives || []).map(a => a.formula)].filter(Boolean)
    fs.forEach(f => {
      const r = tryParse(f); if (!r.ok) return
      getDeps(r.ast).forEach(d => {
        if (d.k === "d" && ids.has(d.id) && d.id !== v.id && !adj[d.id].includes(v.id)) {
          adj[d.id].push(v.id); ind[v.id]++
        }
      })
    })
  })
  const q = vs.filter(v => ind[v.id] === 0).map(v => v.id), res = []
  while (q.length) { const c = q.shift(); res.push(c); (adj[c] || []).forEach(n => { if (--ind[n] === 0) q.push(n) }) }
  vs.forEach(v => { if (!res.includes(v.id)) res.push(v.id) })
  return res.map(id => vs.find(v => v.id === id)).filter(Boolean)
}

// ── Evaluator ────────────────────────────────────────────────
const evalNode = (n, ctx, cs, cl) => {
  if (!n) return null
  const { cid, period, lid, bid } = ctx
  switch (n.t) {
    case "Lit":  return n.v
    case "Var":  return cs[mk(cid, period, n.id, lid, bid)]?.value ?? null
    case "Prev": return cs[mk(cid, prevP(period), n.id, lid, bid)]?.value ?? 0
    case "SumL": {
      const lang = cl.languages.find(l => l.id === lid)
      return lang?.lobs.reduce((s, b) => s + (cs[mk(cid, period, n.id, lid, b.id)]?.value ?? 0), 0) ?? null
    }
    case "SumG": return cl.languages.reduce((s, l) => s + (cs[mk(cid, period, n.id, l.id)]?.value ?? 0), 0)
    case "Op": {
      const l = evalNode(n.l, ctx, cs, cl) ?? 0
      const r = evalNode(n.r, ctx, cs, cl) ?? 0
      if (n.op === "+") return l + r
      if (n.op === "-") return l - r
      if (n.op === "*") return l * r
      return r === 0 ? null : l / r
    }
  }
  return null
}

const calcCell = (v, ctx, cs, cl) => {
  let f = v.formula
  if (v.alternatives?.length) {
    const k = mk(ctx.cid, ctx.period, v.id, ctx.lid, ctx.bid)
    const act = cs[k]?.activeTriggerId
    const alt = v.alternatives.find(a => a.trigger === act)
    f = alt?.formula ?? v.defaultFormula ?? null
  }
  if (!f) return undefined
  const r = tryParse(f); if (!r.ok) return null
  try { return evalNode(r.ast, ctx, cs, cl) } catch { return null }
}

// ── Full Recalculation ───────────────────────────────────────
const recalcAll = (vars, periods, cl, cs) => {
  const c = { ...cs }, cid = cl.id
  const lobV  = topoSort(vars.filter(v => v.scope === "lob"))
  const langV = topoSort(vars.filter(v => v.scope === "language"))
  const tmplV = topoSort(vars.filter(v => v.scope === "template"))
  for (const period of [...periods].sort((a, b) => a - b)) {
    const c0 = { cid, period }
    lobV.forEach(v => cl.languages.forEach(lang => lang.lobs.forEach(lob => {
      const ctx = { ...c0, lid: lang.id, bid: lob.id }
      const val = calcCell(v, ctx, c, cl)
      if (val !== undefined) { const k = mk(cid, period, v.id, lang.id, lob.id); c[k] = { ...c[k], value: val } }
    })))
    langV.forEach(v => cl.languages.forEach(lang => {
      const ctx = { ...c0, lid: lang.id }
      const val = calcCell(v, ctx, c, cl)
      if (val !== undefined) { const k = mk(cid, period, v.id, lang.id); c[k] = { ...c[k], value: val } }
    }))
    tmplV.forEach(v => {
      const val = calcCell(v, c0, c, cl)
      if (val !== undefined) { const k = mk(cid, period, v.id); c[k] = { ...c[k], value: val } }
    })
  }
  return c
}

// ── Diff ─────────────────────────────────────────────────────
const diffCells = (oldCs, newCs) => {
  const dirty = new Set()
  const allKeys = new Set([...Object.keys(oldCs), ...Object.keys(newCs)])
  for (const k of allKeys) {
    if ((oldCs[k]?.value ?? null) !== (newCs[k]?.value ?? null)) dirty.add(k)
  }
  return dirty
}

/* ═══════════════════════════════════════════════════════════════
   DEFAULT DATA
   ═══════════════════════════════════════════════════════════════ */

const CLIENT = {
  id: "c_001", name: "Acme Corp",
  languages: [
    { id: "l_pt", name: "PT", lobs: [{ id: "b_ret", name: "Retalho" }, { id: "b_emp", name: "Empresas" }] },
    { id: "l_en", name: "EN", lobs: [{ id: "b_reta", name: "Retail" }] },
  ]
}

const DEF_VARS = [
  // ── LOB inputs ──────────────────────────────────────────────────────────────────
  { id: "v_rec",  name: "Receita (€)",       scope: "lob",      formula: null,                                           alternatives: [], defaultFormula: null },
  { id: "v_cus",  name: "Custo (€)",         scope: "lob",      formula: null,                                           alternatives: [], defaultFormula: null },
  { id: "v_vol",  name: "Volume (un.)",      scope: "lob",      formula: null,                                           alternatives: [], defaultFormula: null },
  { id: "v_prz",  name: "Prazo médio (d.)", scope: "lob",      formula: null,                                           alternatives: [], defaultFormula: null },
  // ── LOB calculated ──────────────────────────────────────────────────────────────
  // v_rec - v_cus                           subtração directa de 2 inputs
  { id: "v_mar",  name: "Margem (€)",        scope: "lob",      formula: "v_rec - v_cus",                                alternatives: [], defaultFormula: null },
  // (v_rec - v_cus) / v_rec * 100          parênteses + divisão + literal
  { id: "v_pct",  name: "Margem %",          scope: "lob",      formula: "(v_rec - v_cus) / v_rec * 100",               alternatives: [], defaultFormula: null },
  // v_rec / v_vol                           divisão de 2 inputs
  { id: "v_rpu",  name: "Rec./unidade",      scope: "lob",      formula: "v_rec / v_vol",                                alternatives: [], defaultFormula: null },
  // v_cus / v_vol                           divisão de 2 inputs
  { id: "v_cvu",  name: "Custo/unidade",     scope: "lob",      formula: "v_cus / v_vol",                                alternatives: [], defaultFormula: null },
  // v_rpu - v_cvu                           transitividade: calculada de calculadas
  { id: "v_mpu",  name: "Margem/unidade",    scope: "lob",      formula: "v_rpu - v_cvu",                                alternatives: [], defaultFormula: null },
  // v_rec * v_prz / 30                      mult + div + literal
  { id: "v_rot",  name: "Rotação (€·d)",     scope: "lob",      formula: "v_rec * v_prz / 30",                          alternatives: [], defaultFormula: null },
  // PREV(v_sal) + v_mar                     PREV auto-referência + calculada
  { id: "v_sal",  name: "Saldo Acum.",       scope: "lob",      formula: "PREV(v_sal) + v_mar",                         alternatives: [], defaultFormula: null },
  // PREV(v_acm) + v_rec - v_cus            PREV + 2 inputs directos
  { id: "v_acm",  name: "Rec. Acumulada",    scope: "lob",      formula: "PREV(v_acm) + v_rec - v_cus",                alternatives: [], defaultFormula: null },
  // ── Language input ──────────────────────────────────────────────────────────────
  { id: "v_bgt",  name: "Budget (€)",        scope: "language", formula: null,                                           alternatives: [], defaultFormula: null },
  // ── Language calculated ─────────────────────────────────────────────────────────
  // SUM_LOBS(v_rec)                         agregação de input LOB
  { id: "v_trc",  name: "Total Receita",     scope: "language", formula: "SUM_LOBS(v_rec)",                              alternatives: [], defaultFormula: null },
  // SUM_LOBS(v_mar)                         agregação de calculada LOB
  { id: "v_tot",  name: "Total Margem",      scope: "language", formula: "SUM_LOBS(v_mar)",                              alternatives: [], defaultFormula: null },
  // SUM_LOBS(v_mar) / SUM_LOBS(v_rec)*100  dois SUM_LOBS em expressão composta
  { id: "v_eff",  name: "Eficiência %",      scope: "language", formula: "SUM_LOBS(v_mar) / SUM_LOBS(v_rec) * 100",    alternatives: [], defaultFormula: null },
  // SUM_LOBS(v_mar) - v_bgt                SUM_LOBS + ref a input da mesma scope
  { id: "v_dev",  name: "Desvio Budget",     scope: "language", formula: "SUM_LOBS(v_mar) - v_bgt",                    alternatives: [], defaultFormula: null },
  // ── Template input ──────────────────────────────────────────────────────────────
  { id: "v_tgt",  name: "Target (€)",        scope: "template", formula: null,                                           alternatives: [], defaultFormula: null },
  // ── Template calculated ─────────────────────────────────────────────────────────
  // SUM_LANGS(v_trc)                        SUM_LANGS de calculada language
  { id: "v_tgr",  name: "Receita Global",    scope: "template", formula: "SUM_LANGS(v_trc)",                             alternatives: [], defaultFormula: null },
  // SUM_LANGS(v_tot)                        SUM_LANGS de calculada language
  { id: "v_gbl",  name: "Margem Global",     scope: "template", formula: "SUM_LANGS(v_tot)",                             alternatives: [], defaultFormula: null },
  // SUM_LANGS(v_tot)/SUM_LANGS(v_trc)*100  dois SUM_LANGS em expressão composta
  { id: "v_gmg",  name: "Margem Global %",   scope: "template", formula: "SUM_LANGS(v_tot) / SUM_LANGS(v_trc) * 100",  alternatives: [], defaultFormula: null },
  // SUM_LANGS(v_tot) - v_tgt               SUM_LANGS + ref a input da mesma scope
  { id: "v_gap",  name: "Gap vs. Target",    scope: "template", formula: "SUM_LANGS(v_tot) - v_tgt",                    alternatives: [], defaultFormula: null },
]

const DEF_PERIODS = [202601, 202602, 202603]

const initCells = () => {
  const c = {}, cid = "c_001"
  ;[
    ["v_rec", "l_pt", "b_ret",  [1000, 1200,  900]],
    ["v_rec", "l_pt", "b_emp",  [2000, 2100, 2200]],
    ["v_rec", "l_en", "b_reta", [ 500,  600,  550]],
    ["v_cus", "l_pt", "b_ret",  [ 600,  700,  500]],
    ["v_cus", "l_pt", "b_emp",  [1200, 1300, 1250]],
    ["v_cus", "l_en", "b_reta", [ 300,  350,  320]],
    ["v_vol", "l_pt", "b_ret",  [  50,   60,   45]],
    ["v_vol", "l_pt", "b_emp",  [ 100,  105,  110]],
    ["v_vol", "l_en", "b_reta", [  25,   30,   27]],
    ["v_prz", "l_pt", "b_ret",  [  30,   30,   30]],
    ["v_prz", "l_pt", "b_emp",  [  45,   45,   60]],
    ["v_prz", "l_en", "b_reta", [  15,   15,   15]],
  ].forEach(([vid, lid, bid, vals]) =>
    DEF_PERIODS.forEach((p, i) => { c[mk(cid, p, vid, lid, bid)] = { value: vals[i] } })
  )
  ;[
    ["v_bgt", "l_pt", [400, 420, 450]],
    ["v_bgt", "l_en", [150, 160, 175]],
  ].forEach(([vid, lid, vals]) =>
    DEF_PERIODS.forEach((p, i) => { c[mk(cid, p, vid, lid)] = { value: vals[i] } })
  )
  DEF_PERIODS.forEach((p, i) => { c[mk(cid, p, "v_tgt")] = { value: [700, 750, 800][i] } })
  return c
}

/* ═══════════════════════════════════════════════════════════════
   SCOPE CONFIG
   ═══════════════════════════════════════════════════════════════ */

const SC = {
  lob:      { label: "LOB",      badge: "bg-sky-100 text-sky-700",           bg: "bg-sky-50/40" },
  language: { label: "Língua",   badge: "bg-emerald-100 text-emerald-700",   bg: "bg-emerald-50/40" },
  template: { label: "Template", badge: "bg-amber-100 text-amber-700",       bg: "bg-amber-50/40" },
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function EditableCell({ value, onChange, dirty }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  if (editing) return (
    <input
      className="w-full px-3 py-2 text-right text-sm bg-sky-50 border-2 border-sky-400 outline-none font-mono"
      value={draft} autoFocus
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft.replace(",", ".")); onChange(isNaN(n) ? null : n); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === "Enter") { const n = parseFloat(draft.replace(",", ".")); onChange(isNaN(n) ? null : n); setEditing(false) }
        if (e.key === "Escape") setEditing(false)
      }}
    />
  )
  return (
    <div onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true) }}
      className={`relative px-3 py-2 text-right text-sm font-mono cursor-pointer transition-all group
        ${dirty ? "bg-orange-100 hover:bg-orange-200/70" : "hover:bg-white/80"}`}>
      {dirty && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400"/>}
      {value != null
        ? <span className={dirty ? "text-orange-800 font-semibold" : "text-gray-800"}>{fmtV(value)}</span>
        : <span className="text-gray-300 text-xs font-sans opacity-0 group-hover:opacity-100">—</span>
      }
    </div>
  )
}

function CalcCell({ value, formula, altFormula, activeTriggerId, dirty }) {
  const [tip, setTip] = useState(false)
  const displayFm = altFormula ?? formula
  const isErr = value === null && displayFm != null
  return (
    <div onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}
      className={`relative px-3 py-2 text-right text-sm font-mono select-none transition-all
        ${dirty ? "bg-orange-50" : ""}`}>
      {dirty && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400"/>}
      {isErr
        ? <span className="text-red-400 text-xs font-sans font-medium">ERR</span>
        : value != null
          ? <span className={dirty ? "text-orange-700 font-semibold" : altFormula ? "text-violet-600" : "text-gray-500"}>{fmtV(value)}</span>
          : <span className="text-gray-300 text-xs font-sans">—</span>
      }
      {tip && displayFm && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-gray-900 text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap pointer-events-none border border-gray-700">
          {altFormula && <span className="text-violet-400 mr-1.5">@ {activeTriggerId} :</span>}
          <span className="text-emerald-400 font-mono">{displayFm}</span>
        </div>
      )}
    </div>
  )
}

function Badge({ scope }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SC[scope].badge}`}>{SC[scope].label}</span>
}

/* ── Variable Modal ─────────────────────────────────────────── */

function VarModal({ variable, variables, onSave, onClose, onDelete }) {
  const isNew = !variable
  const [name, setName]       = useState(variable?.name ?? "")
  const [id, setId]           = useState(variable?.id ?? "")
  const [scope, setScope]     = useState(variable?.scope ?? "lob")
  const [isInput, setIsInput] = useState(!variable?.formula && !variable?.alternatives?.length)
  const [formula, setFormula] = useState(variable?.formula ?? "")
  const [alts, setAlts]       = useState(variable?.alternatives ?? [])
  const [defFm, setDefFm]     = useState(variable?.defaultFormula ?? "")
  const [errs, setErrs]       = useState({})

  const vf = f => { if (!f?.trim()) return "Vazia"; const r = tryParse(f); return r.ok ? null : r.err }

  const save = () => {
    const e = {}
    if (!name.trim()) e.name = "Obrigatório"
    if (!id.trim())   e.id   = "Obrigatório"
    if (isNew && variables.find(v => v.id === id)) e.id = "ID já existe"
    if (!isInput) {
      if (!alts.length && formula) { const err = vf(formula); if (err) e.formula = err }
      alts.forEach((a, i) => {
        if (!a.trigger) e[`at${i}`] = "Trigger obrigatório"
        if (a.formula)  { const err = vf(a.formula); if (err) e[`af${i}`] = err }
      })
      if (defFm) { const err = vf(defFm); if (err) e.defFm = err }
    }
    if (Object.keys(e).length) { setErrs(e); return }
    onSave({ id, name, scope, formula: isInput ? null : (alts.length ? null : formula || null), alternatives: isInput ? [] : alts, defaultFormula: isInput ? null : (defFm || null) })
  }

  const inputVars = variables.filter(v => !v.formula && !v.alternatives?.length && v.id !== id)
  const fc = k => `w-full border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-sky-400 transition-colors ${errs[k] ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">{isNew ? "Nova Variável" : `Editar · ${variable.name}`}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-lg leading-none transition-colors">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Nome</label>
              <input className={fc("name")} value={name} onChange={e => setName(e.target.value)} placeholder="Receita" />
              {errs.name && <p className="text-red-500 text-xs mt-1">{errs.name}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">ID</label>
              <input className={`${fc("id")} font-mono`} value={id} onChange={e => isNew && setId(e.target.value)}
                style={{ opacity: isNew ? 1 : 0.6 }} readOnly={!isNew} placeholder="v_receita" />
              {errs.id && <p className="text-red-500 text-xs mt-1">{errs.id}</p>}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Âmbito</label>
            <div className="flex gap-2">
              {["lob","language","template"].map(s => (
                <button key={s} onClick={() => setScope(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${scope === s ? SC[s].badge + " ring-2 ring-current ring-offset-1" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {SC[s].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Tipo</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 w-fit">
              {[[true,"Input manual"],[false,"Calculado"]].map(([v,l]) => (
                <button key={l} onClick={() => setIsInput(v)}
                  className={`px-4 py-1.5 text-sm font-medium transition-all ${isInput === v ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>{l}</button>
              ))}
            </div>
          </div>
          {!isInput && (
            <div className="space-y-3">
              {!alts.length ? (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Fórmula</label>
                  <input className={`${fc("formula")} font-mono`} value={formula} onChange={e => setFormula(e.target.value)} placeholder="v_rec - v_cus" />
                  {errs.formula ? <p className="text-red-500 text-xs mt-1">{errs.formula}</p>
                    : formula && tryParse(formula).ok ? <p className="text-emerald-600 text-xs mt-1 font-medium">✓ Válida</p>
                    : formula ? <p className="text-red-500 text-xs mt-1">{tryParse(formula).err}</p> : null}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block">Fórmulas Alternativas</label>
                  {alts.map((a, i) => (
                    <div key={i} className="bg-violet-50 border border-violet-100 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-violet-500 font-bold">@</span>
                        <select value={a.trigger} onChange={e => setAlts(prev => prev.map((x,j)=>j===i?{...x,trigger:e.target.value}:x))}
                          className={`flex-1 border rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none ${errs[`at${i}`]?"border-red-300":"border-gray-200"}`}>
                          <option value="">— trigger —</option>
                          {inputVars.map(v => <option key={v.id} value={v.id}>{v.name} ({v.id})</option>)}
                        </select>
                        <span className="text-gray-400 font-bold">:</span>
                        <button onClick={() => setAlts(prev => prev.filter((_,j)=>j!==i))}
                          className="text-red-400 hover:text-red-600 w-6 h-6 flex items-center justify-center text-xs transition-colors">✕</button>
                      </div>
                      <input value={a.formula} onChange={e => setAlts(prev => prev.map((x,j)=>j===i?{...x,formula:e.target.value}:x))}
                        className={`w-full border rounded-lg px-3 py-1.5 text-sm font-mono bg-white outline-none ${errs[`af${i}`]?"border-red-300":"border-gray-200"}`}
                        placeholder="fórmula para este trigger" />
                      {errs[`at${i}`] && <p className="text-red-500 text-xs">{errs[`at${i}`]}</p>}
                      {errs[`af${i}`] ? <p className="text-red-500 text-xs">{errs[`af${i}`]}</p>
                        : a.formula && tryParse(a.formula).ok ? <p className="text-emerald-600 text-xs font-medium">✓ Válida</p>
                        : a.formula ? <p className="text-red-500 text-xs">{tryParse(a.formula).err}</p> : null}
                    </div>
                  ))}
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Por defeito</label>
                    <input className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono outline-none"
                      value={defFm} onChange={e => setDefFm(e.target.value)} placeholder="0 (opcional)" />
                  </div>
                </div>
              )}
              <button onClick={() => { setAlts(prev => [...prev, { trigger: "", formula: "" }]); setFormula("") }}
                className="text-violet-600 hover:text-violet-800 text-xs font-semibold transition-colors">
                + Adicionar alternativa (@)
              </button>
            </div>
          )}
          <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1.5 border border-gray-100">
            <p className="font-semibold text-gray-700 mb-2">Referência rápida</p>
            {[["v_xxx","referência directa"],["PREV(v_xxx)","período anterior"],["SUM_LOBS(v_xxx)","soma LOBs → scope Língua"],["SUM_LANGS(v_xxx)","soma línguas → scope Template"],["+ − * /  ( )","operadores"]].map(([c,d])=>(
              <p key={c}><code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono">{c}</code> <span className="text-gray-400 ml-1">{d}</span></p>
            ))}
            {variables.filter(v => v.id !== id).length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="font-semibold text-gray-600 mb-1.5">Disponíveis:</p>
                <div className="flex flex-wrap gap-1">
                  {variables.filter(v => v.id !== id).map(v => (
                    <span key={v.id} className="inline-flex gap-1">
                      <code className="bg-gray-200 px-1 rounded font-mono text-gray-700">{v.id}</code>
                      <span className="text-gray-400">{v.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <div>{!isNew && onDelete && <button onClick={onDelete} className="text-red-400 hover:text-red-600 text-sm transition-colors">Eliminar</button>}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
            <button onClick={save} className="px-5 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 transition-colors font-medium">Guardar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */

export default function App() {
  const [vars, setVars]           = useState(DEF_VARS)
  const [periods, setPeriods]     = useState(DEF_PERIODS)
  const [cells, setCells]         = useState(() => recalcAll(DEF_VARS, DEF_PERIODS, CLIENT, initCells()))
  const [dirtyKeys, setDirtyKeys] = useState(new Set())
  const [modal, setModal]         = useState(null)

  /* ── Dirty helpers ── */
  const dirtyVarIds = useMemo(() => {
    const ids = new Set()
    for (const k of dirtyKeys) { const p = k.split("·"); if (p[2]) ids.add(p[2]) }
    return ids
  }, [dirtyKeys])

  const isDirtyCell = (vid, lid, bid, period) => dirtyKeys.has(mk(CLIENT.id, period, vid, lid, bid))
  const isVarDirty  = vid => dirtyVarIds.has(vid)

  /* ── Handlers ── */
  const handleCellChange = (vid, lid, bid, period, val) => {
    const key = mk(CLIENT.id, period, vid, lid, bid)
    let updated = { ...cells, [key]: { ...cells[key], value: val } }
    vars.forEach(v => {
      if (!v.alternatives?.some(a => a.trigger === vid)) return
      periods.forEach(p => {
        const upd = (l, b) => { const k = mk(CLIENT.id, p, v.id, l, b); updated[k] = { ...updated[k], activeTriggerId: vid } }
        if      (v.scope === "template") upd(undefined, undefined)
        else if (v.scope === "language") CLIENT.languages.forEach(l => upd(l.id, undefined))
        else    CLIENT.languages.forEach(l => l.lobs.forEach(b => upd(l.id, b.id)))
      })
    })
    const newCells = recalcAll(vars, periods, CLIENT, updated)
    const dirty    = diffCells(cells, newCells)
    setCells(newCells)
    setDirtyKeys(prev => new Set([...prev, ...dirty]))
  }

  const handleAddPeriod = () => {
    const np = nextP(Math.max(...periods))
    const newPs = [...periods, np]
    setPeriods(newPs)
    setCells(prev => recalcAll(vars, newPs, CLIENT, prev))
  }

  const handleSaveVar = v => {
    setVars(prev => {
      const exists = prev.find(x => x.id === v.id)
      const newVars = exists ? prev.map(x => x.id === v.id ? v : x) : [...prev, v]
      setCells(c => recalcAll(newVars, periods, CLIENT, c))
      return newVars
    })
    setModal(null)
  }

  const handleDelVar = vid => {
    setVars(prev => { const nv = prev.filter(v => v.id !== vid); setCells(c => recalcAll(nv, periods, CLIENT, c)); return nv })
    setModal(null)
  }

  /* ── Grid rows ── */
  const rows = vars.flatMap(v => {
    if (v.scope === "template") return [{ v, lid: undefined, bid: undefined, ctx: "—" }]
    if (v.scope === "language") return CLIENT.languages.map(l => ({ v, lid: l.id, bid: undefined, ctx: l.name }))
    return CLIENT.languages.flatMap(l => l.lobs.map(b => ({ v, lid: l.id, bid: b.id, ctx: `${l.name} / ${b.name}` })))
  })

  const isInput = v => !v.formula && !v.alternatives?.length

  const getActiveFm = (v, lid, bid, period) => {
    if (!v.alternatives?.length) return v.formula
    const k = mk(CLIENT.id, period, v.id, lid, bid)
    const act = cells[k]?.activeTriggerId
    const alt = v.alternatives.find(a => a.trigger === act)
    return alt?.formula ?? v.defaultFormula ?? null
  }

  /* ── Dirty summary grouped by scope ── */
  const dirtyByScope = useMemo(() => {
    const g = { lob: [], language: [], template: [] }
    for (const vid of dirtyVarIds) {
      const v = vars.find(x => x.id === vid)
      if (v && !g[v.scope].includes(vid)) g[v.scope].push(vid)
    }
    return g
  }, [dirtyVarIds, vars])

  const hasDirty = dirtyKeys.size > 0

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">∑</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-none">Motor de Cálculo</h1>
            <p className="text-xs text-gray-400 mt-0.5">{CLIENT.name}</p>
          </div>
        </div>

        {hasDirty && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-xl shrink-0">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"/>
            <span className="text-xs text-orange-700 font-medium">
              {dirtyVarIds.size} variáve{dirtyVarIds.size === 1 ? "l afectada" : "is afectadas"}
            </span>
            <button onClick={() => setDirtyKeys(new Set())} className="text-orange-500 hover:text-orange-700 text-xs font-bold ml-1 transition-colors">×</button>
          </div>
        )}

        <div className="flex-1"/>

        <div className="flex items-center gap-2 border-r border-gray-200 pr-4 shrink-0">
          {Object.entries(SC).map(([k, v]) => (
            <span key={k} className={`text-xs px-2.5 py-1 rounded-full font-medium ${v.badge}`}>{v.label}</span>
          ))}
        </div>

        <button onClick={() => setModal("new")} className="px-3.5 py-2 bg-gray-900 text-white text-xs rounded-xl hover:bg-gray-700 transition-colors font-semibold shrink-0">
          + Variável
        </button>
        <button onClick={handleAddPeriod} className="px-3.5 py-2 bg-emerald-600 text-white text-xs rounded-xl hover:bg-emerald-700 transition-colors font-semibold shrink-0">
          + Período
        </button>
      </header>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm w-full">
          <thead>
            <tr className="bg-white border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
              <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-52">Variável</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-24">Âmbito</th>
              <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-28 border-r border-gray-200">Contexto</th>
              {periods.map(p => (
                <th key={p} className="px-3 py-3 text-center font-semibold text-gray-600 text-xs uppercase tracking-wide min-w-32 border-l border-gray-100">{fmtP(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const { v, lid, bid, ctx } = row
              const prev = rows[idx - 1]
              const isFirst = !prev || prev.v.id !== v.id
              const sc = SC[v.scope]
              const inp = isInput(v)
              const varDirty = isVarDirty(v.id)

              return (
                <tr key={`${v.id}-${lid}-${bid}`}
                  className={`border-b transition-colors ${sc.bg} ${isFirst ? "border-t-2 border-t-gray-200" : "border-gray-100"}`}>

                  <td className="px-4 py-2 align-top">
                    {isFirst && (
                      <div>
                        <div className="flex items-center gap-1.5 group">
                          <span className={`font-semibold text-sm transition-colors ${varDirty ? "text-orange-700" : "text-gray-800"}`}>{v.name}</span>
                          {varDirty && <span className="text-orange-400 text-xs">●</span>}
                          <button onClick={() => setModal(v)} className="text-gray-300 hover:text-sky-500 opacity-0 group-hover:opacity-100 text-xs transition-all">✎</button>
                        </div>
                        <div className={`text-xs font-mono mt-0.5 transition-colors ${varDirty ? "text-orange-500" : "text-gray-400"}`}>{v.id}</div>
                        {!inp && !v.alternatives?.length && v.formula && (
                          <div className="text-xs text-gray-400 font-mono mt-0.5 max-w-48 truncate" title={v.formula}>{v.formula}</div>
                        )}
                        {!inp && v.alternatives?.length > 0 && (
                          <div className="text-xs text-violet-500 mt-0.5 font-medium">{v.alternatives.length} alternativa{v.alternatives.length > 1 ? "s" : ""}</div>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top">
                    {isFirst && <Badge scope={v.scope} />}
                  </td>

                  <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200 align-middle">{ctx}</td>

                  {periods.map(period => {
                    const key = mk(CLIENT.id, period, v.id, lid, bid)
                    const cs  = cells[key]
                    const val = cs?.value
                    const actTrig = cs?.activeTriggerId
                    const activeFm = getActiveFm(v, lid, bid, period)
                    const altFm = (v.alternatives?.length && activeFm !== v.formula) ? activeFm : undefined
                    const dirty = isDirtyCell(v.id, lid, bid, period)
                    return (
                      <td key={period} className="border-l border-gray-100 p-0">
                        {inp
                          ? <EditableCell value={val} dirty={dirty} onChange={nv => handleCellChange(v.id, lid, bid, period, nv)} />
                          : <CalcCell value={val} formula={v.formula} altFormula={altFm} activeTriggerId={actTrig} dirty={dirty} />
                        }
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      {hasDirty ? (
        <footer className="bg-orange-50 border-t border-orange-200 px-5 py-2.5 flex items-center gap-5 text-xs text-orange-700 shrink-0 flex-wrap">
          <span className="font-semibold text-orange-600 shrink-0">Alterações detectadas:</span>
          {["lob","language","template"].map(scope => {
            const ids = dirtyByScope[scope]
            if (!ids?.length) return null
            return (
              <div key={scope} className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full font-medium text-xs ${SC[scope].badge}`}>{SC[scope].label}</span>
                <span className="font-mono text-orange-800">{ids.join("  ·  ")}</span>
              </div>
            )
          })}
          <div className="flex-1"/>
          <button onClick={() => setDirtyKeys(new Set())} className="text-orange-500 hover:text-orange-700 font-semibold transition-colors shrink-0">
            Limpar destaques ×
          </button>
        </footer>
      ) : (
        <footer className="bg-white border-t border-gray-100 px-5 py-2 flex items-center gap-5 text-xs text-gray-400 shrink-0 flex-wrap">
          <span>Input → clique para editar</span>
          <span className="text-gray-500 font-mono">123</span><span>Calculado → hover p/ fórmula</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block"/>Valor alterado desde última edição</span>
          <span className="text-violet-500 font-mono">123</span><span>Fórmula alternativa activa</span>
        </footer>
      )}

      {modal && (
        <VarModal
          variable={modal === "new" ? null : modal}
          variables={vars}
          onSave={handleSaveVar}
          onClose={() => setModal(null)}
          onDelete={modal !== "new" ? () => handleDelVar(modal.id) : null}
        />
      )}
    </div>
  )
}
