import { useState, useMemo, useRef, useEffect } from "react"
/* ═══════════════════════════════════════════════════════════════
   API SERVICE
   Todas as chamadas à API REST do MotorCalculo.Api.
   Base URL: /api (proxied pelo Vite ao servidor .NET em localhost:5000)
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = "/api"

const api = {
  async get(path) {
    const r = await fetch(API_BASE + path)
    if (!r.ok) throw new Error(`API ${path}: ${r.status}`)
    return r.json()
  },
  async patch(path, body) {
    const r = await fetch(API_BASE + path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!r.ok) throw new Error(`API PATCH ${path}: ${r.status}`)
    return r.json()
  },
  async post(path, body) {
    const r = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!r.ok) {
      let detail = ""
      try { const j = await r.json(); detail = j.message || j.title || j.detail || JSON.stringify(j) } catch {}
      throw new Error(`API POST ${path}: ${r.status}${detail ? " — " + detail : ""}`)
    }
    return r.json()
  },
  async put(path, body) {
    const r = await fetch(API_BASE + path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!r.ok) {
      let detail = ""
      try { const j = await r.json(); detail = j.message || j.title || j.detail || JSON.stringify(j) } catch {}
      throw new Error(`API PUT ${path}: ${r.status}${detail ? " — " + detail : ""}`)
    }
    return r.json()
  },
  async delete(path) {
    const r = await fetch(API_BASE + path, { method: "DELETE" })
    if (!r.ok && r.status !== 204) throw new Error(`API DELETE ${path}: ${r.status}`)
    return null
  }
}

// Converte IDs da API (inteiros) para o formato do protótipo (prefixados)
const toLangId = id  => id  != null ? `l_${id}`  : undefined
const toLobId  = id  => id  != null ? `b_${id}`  : undefined
const fromLangId = lid => lid ? parseInt(lid.slice(2)) : null
const fromLobId  = bid => bid ? parseInt(bid.slice(2)) : null

// Carrega todos os dados da API e mapeia para o formato do protótipo
// Apenas lista de projectos — sem carregar variáveis, versões ou células
async function loadProjectList() {
  const projects = await api.get("/projects")
  return Array.isArray(projects) ? projects : []
}

async function loadFromApi(projectId = null) {
  const projects = await api.get("/projects")
  if (!projects.length) throw new Error("Sem projectos na base de dados.")
  const apiProj = projectId
    ? (projects.find(p => p.projectId === projectId) ?? projects[0])
    : projects[0]

  const [structure, apiVars, apiVersions] = await Promise.all([
    api.get(`/projects/${apiProj.projectId}/structure`),
    api.get(`/templates/${apiProj.templateId}/variables`),
    api.get(`/versions?projectId=${apiProj.projectId}`)
  ])

  // Garante que existe pelo menos uma versão
  if (!apiVersions.length) {
    const v = await api.post("/versions", { projectId: apiProj.projectId, code: "BASE", name: "Base" })
    apiVersions.push(v)
  }

  const protoProject = {
    id: `c_${apiProj.projectId}`,
    name: apiProj.name,
    templateId: `tpl_${apiProj.templateId}`,
    languages: structure.languages.map(l => ({
      id: toLangId(l.languageId),
      code: l.code,
      name: l.name,
      lobs: l.lobs.map(b => ({ id: toLobId(b.lobId), code: b.code, name: b.name }))
    }))
  }

  // Mapeia variáveis — usa code como id (igual ao protótipo)
  const protoVars = apiVars.map(v => ({
    id: v.code,
    name: v.name,
    scope: v.scopeCode,
    formula: v.formulas?.find(f => f.formulaType === "main")?.expression ?? null,
    alternatives: (v.formulas ?? [])
      .filter(f => f.formulaType === "alternative")
      .map(f => ({
        trigger: apiVars.find(x => x.variableId === f.triggerVariableId)?.code,
        formula: f.expression
      }))
      .filter(a => a.trigger),
    defaultFormula: v.formulas?.find(f => f.formulaType === "default")?.expression ?? null,
    groupId:   v.groupId   ?? null,
    groupName: v.groupName ?? null,
    _apiId: v.variableId
  }))

  const protoVersions = apiVersions.map((v, i) => ({
    id: v.versionId,
    name: v.name,
    colorIdx: i % VER_PALETTE.length
  }))

  // Carrega células de TODAS as versões
  const allCellsResps = await Promise.all(
    apiVersions.map(v => api.get(`/versions/${v.versionId}/cells`))
  )
  let protoCells = {}
  for (let i = 0; i < apiVersions.length; i++) {
    const mapped = apiCellsToProto(allCellsResps[i].cells, protoProject, protoVars, apiVersions[i].versionId)
    protoCells = { ...protoCells, ...mapped }
  }

  // Períodos únicos presentes nas células (usa a primeira versão)
  const periodSet = new Set(allCellsResps[0].cells.map(c => c.year * 100 + c.month))
  const periods = periodSet.size ? [...periodSet].sort() : [202601, 202602, 202603]

  return {
    allProjects: projects,
    project:    protoProject,
    tplId:      `tpl_${apiProj.templateId}`,
    vars:       protoVars,
    versions:   protoVersions,
    activeVerId: protoVersions[0].id,
    cells:      protoCells,
    periods
  }
}

// Converte array de CellDto (API) para dicionário de células do protótipo
function apiCellsToProto(apiCells, project, vars, versionId) {
  const result = {}
  for (const cell of apiCells) {
    const v = vars.find(x => x._apiId === cell.variableId)
    if (!v) continue
    const lid = toLangId(cell.languageId)
    const bid = toLobId(cell.lobId)
    const period = cell.year * 100 + cell.month
    const key = mk(project.id, versionId, period, v.id, lid, bid)
    result[key] = { value: cell.value, status: cell.status, source: cell.source }
  }
  return result
}



/* ═══════════════════════════════════════════════════════════════
   ENGINE
   Key format: cid · verId · period · varId [· langId [· lobId]]
   A versão é parte da chave — fórmulas nunca são transversais a versões.
   ═══════════════════════════════════════════════════════════════ */

const mk = (cid, ver, p, vid, lid, bid) => {
  const parts = [cid, ver, String(p), vid]
  if (lid != null) parts.push(lid)
  if (bid != null) parts.push(bid)
  return parts.join("·")
}

// Extrai verId da chave (posição 1)
const keyVer = k => k.split("·")[1]

const prevP = p => (p % 100 === 1) ? (Math.floor(p / 100) - 1) * 100 + 12 : p - 1
const nextP = p => (p % 100 === 12) ? (Math.floor(p / 100) + 1) * 100 + 1 : p + 1
const fmtP  = p => { const M = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]; return `${M[p % 100 - 1]} ${Math.floor(p / 100)}` }
const fmtV  = v => { if (v == null) return null; if (!isFinite(v) || isNaN(v)) return "ERR"; return v.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) }

// ── Tokenizer ────────────────────────────────────────────────
function tokenize(s) {
  const ts = []; let i = 0; s = s.trim()
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue }
    if (/\d/.test(s[i])) { let n = ""; while (i < s.length && /[\d.]/.test(s[i])) n += s[i++]; ts.push({ t: "NUM", v: +n }); continue }
    if (/[a-zA-Z_]/.test(s[i])) { let w = ""; while (i < s.length && /\w/.test(s[i])) w += s[i++]; const kw = { PREV: "PREV", SUM_LOBS: "SL", SUM_LANGS: "SG", COUNT_LOBS: "CL", COUNT_LANGS: "CG", WEIGHT: "WGT", WEIGHT_LANG: "WGL" }; ts.push({ t: kw[w] ?? "VAR", v: w }); continue }
    const ops = { "+": "+", "-": "-", "*": "*", "/": "/", "(": "(", ")": ")", "[": "[", "]": "]" }
    if (ops[s[i]]) { ts.push({ t: ops[s[i]] }); i++ } else throw new Error(`'${s[i]}'`)
  }
  return ts
}

// ── Parser ───────────────────────────────────────────────────
class Parser {
  constructor(ts) { this.ts = ts; this.i = 0 }
  pk() { return this.ts[this.i] } eat() { return this.ts[this.i++] } end() { return this.i >= this.ts.length }
  ex(t) { const tk = this.eat(); if (!tk || tk.t !== t) throw new Error(`Esperado ${t}, obtido ${tk?.t ?? "fim"}`); return tk }
  mt(...ts) { return ts.includes(this.pk()?.t) }
  parse() { if (!this.ts.length) throw new Error("Fórmula vazia"); const n = this.expr(); if (!this.end()) throw new Error(`Token inesperado: ${this.pk()?.t}`); return n }
  expr() { let n = this.term(); while (this.mt("+", "-")) { const op = this.eat().t; n = { t: "Op", op, l: n, r: this.term() } } return n }
  term() { let n = this.factor(); while (this.mt("*", "/")) { const op = this.eat().t; n = { t: "Op", op, l: n, r: this.factor() } } return n }

  // Parseia qualificadores opcionais [lang][lob] após um identificador de variável.
  // Cada dimensão pode ser um código de língua/LOB ou * (relativo = herda contexto).
  // null significa "não especificado" — equivalente a *.
  parseQualifiers() {
    let lang = null, lob = null
    if (!this.mt("[")) return { lang, lob }
    this.eat()  // consume [
    const lt = this.pk()
    if (!lt) throw new Error("Esperado código ou * no qualificador de língua")
    if (lt.t === "*")   { this.eat(); lang = "*" }
    else if (lt.t === "VAR") { this.eat(); lang = lt.v }
    else throw new Error(`Qualificador de língua inválido: ${lt.t}`)
    this.ex("]")
    if (!this.mt("[")) return { lang, lob }
    this.eat()  // consume [
    const bt = this.pk()
    if (!bt) throw new Error("Esperado código ou * no qualificador de LOB")
    if (bt.t === "*")   { this.eat(); lob = "*" }
    else if (bt.t === "VAR") { this.eat(); lob = bt.v }
    else throw new Error(`Qualificador de LOB inválido: ${bt.t}`)
    this.ex("]")
    return { lang, lob }
  }

  factor() {
    const tk = this.pk(); if (!tk) throw new Error("Expressão incompleta")
    if (tk.t === "NUM") { this.eat(); return { t: "Lit", v: tk.v } }
    if (tk.t === "(")   { this.eat(); const e = this.expr(); this.ex(")"); return e }
    if (tk.t === "PREV") {
      this.eat(); this.ex("("); const v = this.ex("VAR").v
      const { lang, lob } = this.parseQualifiers()
      this.ex(")"); return { t: "Prev", id: v, lang, lob }
    }
    if (tk.t === "SL") {
      this.eat(); this.ex("("); const v = this.ex("VAR").v
      const { lang, lob } = this.parseQualifiers()
      this.ex(")"); return { t: "SumL", id: v, lang, lob }
    }
    if (tk.t === "SG") {
      this.eat(); this.ex("("); const v = this.ex("VAR").v
      const { lang, lob } = this.parseQualifiers()
      this.ex(")"); return { t: "SumG", id: v, lang, lob }
    }
    if (tk.t === "CL") { this.eat(); this.ex("("); this.ex(")"); return { t: "CntL" } }
    if (tk.t === "CG") { this.eat(); this.ex("("); this.ex(")"); return { t: "CntG" } }
    if (tk.t === "WGT") {
      this.eat(); this.ex("("); const wv = this.ex("VAR").v; this.ex(")")
      // só aceita [*] como qualificador
      let wlang = null
      if (this.pk()?.t === "[") {
        this.eat()
        const spec = this.pk()?.v
        this.eat(); this.ex("]")
        if (spec !== "*") throw new Error("WEIGHT só suporta [*]. Use WEIGHT_LANG para pesos de língua.")
        wlang = "*"
      }
      return { t: "Wgt", id: wv, lang: wlang }
    }
    if (tk.t === "WGL") {
      this.eat(); this.ex("("); const wlv = this.ex("VAR").v; this.ex(")")
      return { t: "WgtL", id: wlv }
    }
    if (tk.t === "VAR") {
      this.eat()
      const { lang, lob } = this.parseQualifiers()
      return { t: "Var", id: tk.v, lang, lob }
    }
    throw new Error(`Token inesperado: ${tk.t}`)
  }
}

const tryParse = f => { try { return { ok: true, ast: new Parser(tokenize(f)).parse() } } catch (e) { return { ok: false, err: e.message } } }

// Valida que os qualificadores [lang][lob] existem na estrutura do cliente.
// Chamada apenas na gravação da fórmula — não em runtime.
const validateQualifiers = (ast, client) => {
  const errors = []
  function walk(n) {
    if (!n) return
    if (["Var","Prev","SumL","SumG"].includes(n.t)) {
      if (n.lang && n.lang !== "*") {
        const lang = client.languages.find(l => l.code === n.lang)
        if (!lang) errors.push(`Língua '${n.lang}' não existe neste cliente`)
        else if (n.lob && n.lob !== "*") {
          if (!lang.lobs.find(b => b.code === n.lob))
            errors.push(`LOB '${n.lob}' não existe em '${n.lang}'`)
        }
      } else if (n.lob && n.lob !== "*") {
        if (!client.languages.some(l => l.lobs.some(b => b.code === n.lob)))
          errors.push(`LOB '${n.lob}' não existe em nenhuma língua`)
      }
    }
    if (n.l) walk(n.l); if (n.r) walk(n.r)
  }
  walk(ast)
  return errors
}

// Parse + validação de qualificadores (para usar na gravação de fórmulas no modal).
const tryParseValidate = (f, client) => {
  const r = tryParse(f); if (!r.ok) return r
  if (client) {
    const qErr = validateQualifiers(r.ast, client)
    if (qErr.length) return { ok: false, err: qErr[0] }
  }
  return r
}

const getDeps = n => {
  if (!n) return []
  if (n.t === "Lit")  return []
  if (n.t === "Var")  return [{ k: "d",  id: n.id }]
  if (n.t === "Prev") return [{ k: "pv", id: n.id }]
  if (n.t === "SumL") return [{ k: "sl", id: n.id }]
  if (n.t === "SumG") return [{ k: "sg", id: n.id }]
  if (n.t === "Wgt")  return [{ k: "wt", id: n.id }]
  if (n.t === "WgtL") return [{ k: "wl", id: n.id }]
  if (n.t === "Op")   return [...getDeps(n.l), ...getDeps(n.r)]
  return []
}

// ── Topological Sort ─────────────────────────────────────────
const topoSort = vs => {
  const ids = new Set(vs.map(v => v.id)), adj = {}, ind = {}
  vs.forEach(v => { adj[v.id] = []; ind[v.id] = 0 })
  vs.forEach(v => {
    [v.formula, ...(v.alternatives || []).map(a => a.formula)].filter(Boolean).forEach(f => {
      const r = tryParse(f); if (!r.ok) return
      getDeps(r.ast).forEach(d => { if (d.k === "d" && ids.has(d.id) && d.id !== v.id && !adj[d.id].includes(v.id)) { adj[d.id].push(v.id); ind[v.id]++ } })
    })
  })
  const q = vs.filter(v => ind[v.id] === 0).map(v => v.id), res = []
  while (q.length) { const c = q.shift(); res.push(c); (adj[c] || []).forEach(n => { if (--ind[n] === 0) q.push(n) }) }
  vs.forEach(v => { if (!res.includes(v.id)) res.push(v.id) })
  return res.map(id => vs.find(v => v.id === id)).filter(Boolean)
}

// ── Update order ─────────────────────────────────────────────
const computeUpdateOrder = (vars, targetVarIds) => {
  const targetSet = new Set(targetVarIds)
  const calcDeps = {}
  for (const v of vars) {
    if (!v.formula && !v.alternatives?.length) continue
    calcDeps[v.id] = new Set()
    ;[v.formula, ...(v.alternatives || []).map(a => a.formula)].filter(Boolean).forEach(f => {
      const r = tryParse(f); if (!r.ok) return
      getDeps(r.ast).forEach(d => calcDeps[v.id].add(d.id))
    })
  }
  const affected = new Set(targetVarIds)
  let changed = true
  while (changed) { changed = false; for (const [vid, deps] of Object.entries(calcDeps)) { if (!affected.has(vid) && [...deps].some(id => affected.has(id))) { affected.add(vid); changed = true } } }
  const seq = [...topoSort(vars.filter(v => v.scope === "lob")), ...topoSort(vars.filter(v => v.scope === "language")), ...topoSort(vars.filter(v => v.scope === "project"))].filter(v => affected.has(v.id) && !targetSet.has(v.id))
  const order = {}; seq.forEach((v, i) => { order[v.id] = i + 1 }); return order
}

// ── Evaluator ────────────────────────────────────────────────
// ctx includes { cid, ver, period, lid, bid }
// Regras:
//   célula ausente     → 0     (input por preencher)
//   célula value=null  → null  (ERR — propaga)
//   Op com null        → null  (ERR propaga por toda a cadeia)
//   Prev inexistente   → 0     (antes do início = zero)
//   Prev com ERR       → null  (ERR viaja pelo tempo)
const evalNode = (n, ctx, cs, cl) => {
  if (!n) return null
  const { cid, ver, period, lid, bid } = ctx

  // Resolve um código de língua para language_id.
  // null ou "*" → herda o contexto corrente (lid).
  const resLid = (code) =>
    (code && code !== "*") ? cl.languages.find(l => l.code === code)?.id ?? null : lid

  // Resolve um código de LOB para lob_id dentro de uma língua resolvida.
  // null ou "*" → herda o contexto corrente (bid).
  const resBid = (code, resolvedLid) => {
    if (!code || code === "*") return bid
    const lang = cl.languages.find(l => l.id === resolvedLid)
    return lang?.lobs.find(b => b.code === code)?.id ?? null
  }

  switch (n.t) {
    case "Lit": return n.v

    case "Var": {
      const rLid = resLid(n.lang), rBid = resBid(n.lob, rLid)
      // Cross-scope fallback: LOB → língua → projecto
      let cell = cs[mk(cid, ver, period, n.id, rLid, rBid)]
      if (cell === undefined && rBid != null)
        cell = cs[mk(cid, ver, period, n.id, rLid, undefined)]
      if (cell === undefined && rLid != null)
        cell = cs[mk(cid, ver, period, n.id, undefined, undefined)]
      return cell === undefined ? 0 : cell.value
    }

    case "Prev": {
      const rLid = resLid(n.lang), rBid = resBid(n.lob, rLid)
      const cell = cs[mk(cid, ver, prevP(period), n.id, rLid, rBid)]
      return cell === undefined ? 0 : cell.value
    }

    case "CntL": {
      const curLang = cl.languages.find(l => l.id === lid)
      return curLang?.lobs?.length ?? 0
    }
    case "CntG": return cl.languages.length
    case "Wgt": {
      // WEIGHT(v_xxx) / WEIGHT(v_xxx)[*]
      const num = cs[mk(cid, ver, period, n.id, lid, bid)]?.value ?? null
      if (num === null) return 0
      let denom = 0
      if (!n.lang) {
        for (const l of cl.languages)
          for (const b of l.lobs) {
            const c = cs[mk(cid, ver, period, n.id, l.id, b.id)]
            if (c?.value != null) denom += c.value
          }
      } else { // "*"
        const curL = cl.languages.find(l => l.id === lid)
        if (curL) for (const b of curL.lobs) {
          const c = cs[mk(cid, ver, period, n.id, lid, b.id)]
          if (c?.value != null) denom += c.value
        }
      }
      return denom === 0 ? null : num / denom
    }
    case "WgtL": {
      // WEIGHT_LANG(v_xxx)
      const numL = cs[mk(cid, ver, period, n.id, lid, undefined)]?.value ?? null
      if (numL === null) return 0
      let denomL = 0
      for (const l of cl.languages) {
        const c = cs[mk(cid, ver, period, n.id, l.id, undefined)]
        if (c?.value != null) denomL += c.value
      }
      return denomL === 0 ? null : numL / denomL
    }
    case "SumL": {
      // SumL itera os LOBs da língua resolvida (fixa ou relativa).
      const rLid = resLid(n.lang)
      const lang = cl.languages.find(l => l.id === rLid); if (!lang) return null
      let s = 0
      for (const b of lang.lobs) {
        const rBid = (n.lob && n.lob !== "*")
          ? lang.lobs.find(lb => lb.code === n.lob)?.id ?? null : b.id
        const cell = cs[mk(cid, ver, period, n.id, rLid, rBid)]
        const v = cell === undefined ? 0 : cell.value
        if (v === null) return null
        s += v
        if (n.lob && n.lob !== "*") break   // lob fixo: uma iteração
      }
      return s
    }

    case "SumG": {
      // SumG itera todas as línguas (ou apenas a fixada).
      let s = 0
      for (const l of cl.languages) {
        const rLid = (n.lang && n.lang !== "*")
          ? cl.languages.find(lg => lg.code === n.lang)?.id ?? null : l.id
        const cell = cs[mk(cid, ver, period, n.id, rLid)]
        const v = cell === undefined ? 0 : cell.value
        if (v === null) return null
        s += v
        if (n.lang && n.lang !== "*") break  // lang fixo: uma iteração
      }
      return s
    }

    case "Op": {
      const l = evalNode(n.l, ctx, cs, cl)
      const r = evalNode(n.r, ctx, cs, cl)
      if (l === null || r === null) return null
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
    const k = mk(ctx.cid, ctx.ver, ctx.period, v.id, ctx.lid, ctx.bid)
    const act = cs[k]?.activeTriggerId
    const alt = v.alternatives.find(a => a.trigger === act)
    f = alt?.formula ?? v.defaultFormula ?? null
  }
  if (!f) return undefined
  const r = tryParse(f); if (!r.ok) return null
  try { return evalNode(r.ast, ctx, cs, cl) } catch { return null }
}

// recalcAll é estritamente circunscrito a uma única versão
const recalcAll = (vars, periods, cl, cs, verId) => {
  const c = { ...cs }, cid = cl.id
  const lobV = topoSort(vars.filter(v => v.scope === "lob"))
  const langV = topoSort(vars.filter(v => v.scope === "language"))
  const tmplV = topoSort(vars.filter(v => v.scope === "project"))
  for (const period of [...periods].sort((a, b) => a - b)) {
    const c0 = { cid, ver: verId, period }
    lobV.forEach(v => cl.languages.forEach(lang => lang.lobs.forEach(lob => {
      const ctx = { ...c0, lid: lang.id, bid: lob.id }
      const val = calcCell(v, ctx, c, cl)
      if (val !== undefined) { const k = mk(cid, verId, period, v.id, lang.id, lob.id); c[k] = { ...c[k], value: val } }
    })))
    langV.forEach(v => cl.languages.forEach(lang => {
      const ctx = { ...c0, lid: lang.id }
      const val = calcCell(v, ctx, c, cl)
      if (val !== undefined) { const k = mk(cid, verId, period, v.id, lang.id); c[k] = { ...c[k], value: val } }
    }))
    tmplV.forEach(v => {
      const val = calcCell(v, c0, c, cl)
      if (val !== undefined) { const k = mk(cid, verId, period, v.id); c[k] = { ...c[k], value: val } }
    })
  }
  return c
}

// Diff circunscrito à versão activa
const diffCells = (oldCs, newCs, verId) => {
  const dirty = new Set()
  for (const k of new Set([...Object.keys(oldCs), ...Object.keys(newCs)])) {
    if (keyVer(k) !== verId) continue
    if ((oldCs[k]?.value ?? null) !== (newCs[k]?.value ?? null)) dirty.add(k)
  }
  return dirty
}

// Clona todos os valores de uma versão para outra
// Clona apenas as células INPUT de uma versão para outra.
// Células calculadas não são copiadas — nascem de novo via recalcAll.
// Evita duplicar registos redundantes que seriam imediatamente sobrepostos.
const cloneVersionCells = (cs, fromVerId, toVerId, vars) => {
  const inputIds = new Set(
    vars.filter(v => !v.formula && !v.alternatives?.length).map(v => v.id)
  )
  const out = {}
  for (const [key, val] of Object.entries(cs)) {
    if (keyVer(key) !== fromVerId) continue
    const varId = key.split("·")[3]        // posição 3 = varId
    if (!inputIds.has(varId)) continue     // ignora calculadas
    const parts = key.split("·")
    parts[1] = toVerId
    out[parts.join("·")] = { ...val }
  }
  return { ...cs, ...out }
}

// Elimina todas as células de uma versão
const deleteVersionCells = (cs, verId) => {
  const out = {}
  for (const [key, val] of Object.entries(cs)) { if (keyVer(key) !== verId) out[key] = val }
  return out
}

/* ═══════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════ */

// CLIENT is the initial hardcoded value; the mutable version lives in App state (client).
// Each language and LOB has both code (used in formula qualifiers [PT][ret]) and name (display).
const CLIENT = {
  id: "c_001", name: "Acme Corp",
  languages: [
    { id: "l_pt", code: "PT", name: "Português", lobs: [
      { id: "b_ret",  code: "ret",  name: "Retalho"  },
      { id: "b_emp",  code: "emp",  name: "Empresas" },
    ]},
    { id: "l_en", code: "EN", name: "English", lobs: [
      { id: "b_reta", code: "reta", name: "Retail" },
    ]},
  ]
}

const DEF_VARS = [
  { id: "v_rec", name: "Receita (€)",      scope: "lob",      formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_cus", name: "Custo (€)",        scope: "lob",      formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_vol", name: "Volume (un.)",     scope: "lob",      formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_prz", name: "Prazo médio (d.)",scope: "lob",      formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_mar", name: "Margem (€)",       scope: "lob",      formula: "v_rec - v_cus",                               alternatives: [], defaultFormula: null },
  { id: "v_pct", name: "Margem %",         scope: "lob",      formula: "(v_rec - v_cus) / v_rec * 100",              alternatives: [], defaultFormula: null },
  { id: "v_rpu", name: "Rec./unidade",     scope: "lob",      formula: "v_rec / v_vol",                               alternatives: [], defaultFormula: null },
  { id: "v_cvu", name: "Custo/unidade",    scope: "lob",      formula: "v_cus / v_vol",                               alternatives: [], defaultFormula: null },
  { id: "v_mpu", name: "Margem/unidade",   scope: "lob",      formula: "v_rpu - v_cvu",                               alternatives: [], defaultFormula: null },
  { id: "v_rot", name: "Rotação (€·d)",    scope: "lob",      formula: "v_rec * v_prz / 30",                         alternatives: [], defaultFormula: null },
  { id: "v_sal", name: "Saldo Acum.",      scope: "lob",      formula: "PREV(v_sal) + v_mar",                        alternatives: [], defaultFormula: null },
  { id: "v_acm", name: "Rec. Acumulada",   scope: "lob",      formula: "PREV(v_acm) + v_rec - v_cus",               alternatives: [], defaultFormula: null },
  { id: "v_bgt", name: "Budget (€)",       scope: "language", formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_trc", name: "Total Receita",    scope: "language", formula: "SUM_LOBS(v_rec)",                             alternatives: [], defaultFormula: null },
  { id: "v_tot", name: "Total Margem",     scope: "language", formula: "SUM_LOBS(v_mar)",                             alternatives: [], defaultFormula: null },
  { id: "v_eff", name: "Eficiência %",     scope: "language", formula: "SUM_LOBS(v_mar) / SUM_LOBS(v_rec) * 100",   alternatives: [], defaultFormula: null },
  { id: "v_dev", name: "Desvio Budget",    scope: "language", formula: "SUM_LOBS(v_mar) - v_bgt",                   alternatives: [], defaultFormula: null },
  { id: "v_tgt", name: "Target (€)",       scope: "project", formula: null,                                          alternatives: [], defaultFormula: null },
  { id: "v_tgr", name: "Receita Global",   scope: "project", formula: "SUM_LANGS(v_trc)",                            alternatives: [], defaultFormula: null },
  { id: "v_gbl", name: "Margem Global",    scope: "project", formula: "SUM_LANGS(v_tot)",                            alternatives: [], defaultFormula: null },
  { id: "v_gmg", name: "Margem Global %",  scope: "project", formula: "SUM_LANGS(v_tot) / SUM_LANGS(v_trc) * 100", alternatives: [], defaultFormula: null },
  { id: "v_gap", name: "Gap vs. Target",   scope: "project", formula: "SUM_LANGS(v_tot) - v_tgt",                   alternatives: [], defaultFormula: null },
  // ── Variáveis com referências absolutas [lang][lob] — demonstração da sintaxe ──
  // v_idx: índice de receita de cada LOB face ao PT/Retalho (base=100)
  //   v_rec         → receita do contexto corrente (relativa)
  //   v_rec[PT][ret]→ receita de PT/Retalho sempre (absoluta)
  { id: "v_idx", name: "Índice vs PT/Ret",  scope: "lob",      formula: "v_rec / v_rec[PT][ret] * 100",   alternatives: [], defaultFormula: null },
  // v_dif: desvio de margem de cada língua face a PT (absoluto)
  //   v_tot         → margem total da língua corrente (relativa)
  //   v_tot[PT]     → margem total de PT sempre (absoluta)
  { id: "v_dif", name: "Desvio vs PT",      scope: "language", formula: "v_tot - v_tot[PT]",              alternatives: [], defaultFormula: null },
  // v_cmp: rácio de margem total PT/EN × 100
  //   v_tot[PT] e v_tot[EN] são ambas referências absolutas
  { id: "v_cmp", name: "Rácio PT/EN %",     scope: "project", formula: "v_tot[PT] / v_tot[EN] * 100",   alternatives: [], defaultFormula: null },
  // ── Variável com fórmulas alternativas — exemplo do mecanismo @ ───────────
  // Resultado Ajustado usa fórmulas diferentes consoante o último input editado:
  //   @ v_prz  →  margem penalizada pelo prazo médio   (v_mar - v_mar * v_prz / 100)
  //   @ v_vol  →  margem por unidade × volume           (v_mar / v_vol * v_vol = v_mpu * v_vol... simplif: v_mar * v_vol / 50)
  //   default  →  apenas a margem directa               (v_mar)
  // Triggers: v_prz e v_vol são inputs existentes — editar qualquer um deles activa a fórmula correspondente.
  { id: "v_res", name: "Result. Ajustado", scope: "lob",
    formula: null,
    alternatives: [
      { trigger: "v_prz", formula: "v_mar - v_mar * v_prz / 100" },
      { trigger: "v_vol", formula: "v_mar * v_vol / 50" },
    ],
    defaultFormula: "v_mar" },
]

const DEF_PERIODS = [202601, 202602, 202603]

const buildCells = (verId) => {
  const c = {}, cid = "c_001"
  ;[
    ["v_rec","l_pt","b_ret",  [1000,1200, 900]],
    ["v_rec","l_pt","b_emp",  [2000,2100,2200]],
    ["v_rec","l_en","b_reta", [ 500, 600, 550]],
    ["v_cus","l_pt","b_ret",  [ 600, 700, 500]],
    ["v_cus","l_pt","b_emp",  [1200,1300,1250]],
    ["v_cus","l_en","b_reta", [ 300, 350, 320]],
    ["v_vol","l_pt","b_ret",  [  50,  60,  45]],
    ["v_vol","l_pt","b_emp",  [ 100, 105, 110]],
    ["v_vol","l_en","b_reta", [  25,  30,  27]],
    ["v_prz","l_pt","b_ret",  [  30,  30,  30]],
    ["v_prz","l_pt","b_emp",  [  45,  45,  60]],
    ["v_prz","l_en","b_reta", [  15,  15,  15]],
  ].forEach(([vid, lid, bid, vals]) => DEF_PERIODS.forEach((p, i) => { c[mk(cid, verId, p, vid, lid, bid)] = { value: vals[i] } }))
  ;[["v_bgt","l_pt",[400,420,450]], ["v_bgt","l_en",[150,160,175]]].forEach(([vid, lid, vals]) =>
    DEF_PERIODS.forEach((p, i) => { c[mk(cid, verId, p, vid, lid)] = { value: vals[i] } }))
  DEF_PERIODS.forEach((p, i) => { c[mk(cid, verId, p, "v_tgt")] = { value: [700,750,800][i] } })
  return c
}

/* ═══════════════════════════════════════════════════════════════
   VERSIONS
   ═══════════════════════════════════════════════════════════════ */

const VER_PALETTE = [
  { dot: "bg-indigo-400",  tab: "text-indigo-700",  active: "border-indigo-400 text-indigo-700",  bg: "bg-indigo-50/60"  },
  { dot: "bg-emerald-400", tab: "text-emerald-700", active: "border-emerald-400 text-emerald-700", bg: "bg-emerald-50/60" },
  { dot: "bg-rose-400",    tab: "text-rose-700",    active: "border-rose-400 text-rose-700",       bg: "bg-rose-50/60"    },
  { dot: "bg-amber-400",   tab: "text-amber-700",   active: "border-amber-400 text-amber-700",     bg: "bg-amber-50/60"   },
  { dot: "bg-violet-400",  tab: "text-violet-700",  active: "border-violet-400 text-violet-700",   bg: "bg-violet-50/60"  },
  { dot: "bg-sky-400",     tab: "text-sky-700",     active: "border-sky-400 text-sky-700",         bg: "bg-sky-50/60"     },
]
const verColor = (idx) => VER_PALETTE[idx % VER_PALETTE.length]

const DEF_VERSION = { id: "ver_001", name: "Base", colorIdx: 0 }

/* ═══════════════════════════════════════════════════════════════
   TESTS + DICTIONARY  (unchanged — version-independent)
   ═══════════════════════════════════════════════════════════════ */

const TESTS = [
  { id:"t01", label:"T01 · Subtração directa",       desc:"Altera Receita → observa Margem e Margem %",                                   targets:["v_rec"] },
  { id:"t02", label:"T02 · Divisão de dois inputs",  desc:"Altera Volume → observa Rec./un. e Custo/un.",                                 targets:["v_vol"] },
  { id:"t03", label:"T03 · Transitividade",          desc:"Altera Volume → observa Margem/un. (depende de Rec./un. e Custo/un.)",          targets:["v_vol"] },
  { id:"t04", label:"T04 · Multiplicação + literal", desc:"Altera Prazo médio → observa Rotação  ( rec × prz / 30 )",                     targets:["v_prz"] },
  { id:"t05", label:"T05 · PREV auto-referência",    desc:"Altera Receita → observa Saldo Acum. propagar entre períodos",                  targets:["v_rec"] },
  { id:"t06", label:"T06 · PREV + 2 inputs",         desc:"Altera Receita e Custo → observa Rec. Acumulada em todos os períodos",          targets:["v_rec","v_cus"] },
  { id:"t07", label:"T07 · SUM_LOBS de input",       desc:"Altera Receita → observa Total Receita (agregação de todos os LOBs)",           targets:["v_rec"] },
  { id:"t08", label:"T08 · SUM_LOBS composto",       desc:"Altera Receita e Custo → observa Eficiência %  ( SUM_LOBS / SUM_LOBS )",        targets:["v_rec","v_cus"] },
  { id:"t09", label:"T09 · Input scope Língua",      desc:"Altera Budget → observa Desvio Budget  ( SUM_LOBS − budget )",                  targets:["v_bgt"] },
  { id:"t10", label:"T10 · SUM_LANGS",               desc:"Altera Receita → observa Receita Global e Margem Global (agregação de línguas)", targets:["v_rec"] },
  { id:"t11", label:"T11 · Input scope Projeto",     desc:"Altera Target → observa Gap vs. Target  ( SUM_LANGS − target )",               targets:["v_tgt"] },
  { id:"t12", label:"T12 · Propagação completa",     desc:"Altera Receita → observa toda a cadeia até Margem Global %",                   targets:["v_rec"] },
  { id:"t13", label:"T13 · Fórmulas alternativas (@)", desc:"Edita Prazo ou Volume → observa Result. Ajustado mudar de fórmula automaticamente", targets:["v_prz","v_vol"] },
  { id:"t14", label:"T14 · Referências absolutas [lang][lob]", desc:"Altera Receita de PT/Retalho → observa v_idx, v_dif e v_cmp actualizarem com contextos fixos", targets:["v_rec"] },
]

const DICT = {
  t01:{what:"Verifica que uma alteração num input se propaga directamente a todas as variáveis que dele dependem por operações de subtração e divisão.",formulas:["v_mar  =  v_rec − v_cus","v_pct  =  (v_rec − v_cus) / v_rec × 100"],steps:["Selecciona T01 na dropdown de testes.","Clica numa célula verde de Receita (v_rec) e altera: 1 000 → 1 200.","Verifica que Margem e Margem % ficam a laranja e reflectem os novos valores."],ctx:"PT/Retalho · Jan",rows:[{l:"Receita  (v_rec)",b:"1 000",a:"1 200",t:"i"},{l:"Custo    (v_cus)",b:"600",a:"600",t:"c"},{l:"Margem   (v_mar)",b:"400",a:"600",t:"x"},{l:"Margem % (v_pct)",b:"40,00 %",a:"50,00 %",t:"x"}],note:"O v_pct usa parênteses — confirma que (v_rec − v_cus) é avaliado antes da divisão."},
  t02:{what:"Verifica a divisão entre dois inputs distintos da mesma célula de contexto.",formulas:["v_rpu  =  v_rec / v_vol","v_cvu  =  v_cus / v_vol"],steps:["Selecciona T02. Altera Volume: 50 → 40.","Observa Rec./unidade e Custo/unidade a actualizar.","Bónus: altera Volume para 0 → ERR (divisão por zero propaga)."],ctx:"PT/Retalho · Jan",rows:[{l:"Volume       (v_vol)",b:"50",a:"40",t:"i"},{l:"Rec./unidade (v_rpu)",b:"20,00",a:"25,00",t:"x"},{l:"Custo/unid.  (v_cvu)",b:"12,00",a:"15,00",t:"x"}],note:"Volume=0 → v_rpu=ERR → v_mpu=ERR (null propaga, não é mascarado por 0)."},
  t03:{what:"Verifica que uma alteração num input propaga por duas calculadas intermédias (teste de ordenação topológica).",formulas:["v_rpu = v_rec / v_vol","v_cvu = v_cus / v_vol","v_mpu = v_rpu − v_cvu"],steps:["Selecciona T03. Altera Volume: 50 → 40.","Confirma que os números de sequência mostram v_rpu e v_cvu antes de v_mpu."],ctx:"PT/Retalho · Jan",rows:[{l:"Volume        (v_vol)",b:"50",a:"40",t:"i"},{l:"Rec./unidade  (v_rpu)",b:"20,00",a:"25,00",t:"x"},{l:"Custo/unidade (v_cvu)",b:"12,00",a:"15,00",t:"x"},{l:"Margem/unid.  (v_mpu)",b:"8,00",a:"10,00",t:"x"}],note:"O topoSort garante que v_rpu e v_cvu estão calculados antes de v_mpu usar os seus valores."},
  t04:{what:"Verifica a multiplicação de dois inputs seguida de divisão por constante literal.",formulas:["v_rot  =  v_rec × v_prz / 30"],steps:["Selecciona T04. Altera Prazo médio: 30 → 45.","Observa Rotação: 1 000 × 45 / 30 = 1 500."],ctx:"PT/Retalho · Jan",rows:[{l:"Prazo médio (v_prz)",b:"30",a:"45",t:"i"},{l:"Rotação     (v_rot)",b:"1 000",a:"1 500",t:"x"}],note:"Precedência: × e / avaliados da esquerda para a direita: (v_rec × v_prz) / 30."},
  t05:{what:"Verifica que PREV() lê o período anterior e que alterações propagam em cascata por todos os períodos seguintes.",formulas:["v_sal  =  PREV(v_sal) + v_mar","(período inexistente → 0)"],steps:["Selecciona T05. Altera Receita de Jan: 1 000 → 1 500.","Observa Saldo: Jan→Fev→Mar propagam em cascata."],ctx:"PT/Retalho · todos os períodos",rows:[{l:"Saldo Jan (v_sal)",b:"400",a:"900",t:"x"},{l:"Saldo Fev (v_sal)",b:"900",a:"1 400",t:"x"},{l:"Saldo Mar (v_sal)",b:"1 300",a:"1 800",t:"x"}],note:"Período anterior inexistente → 0. ERR no período anterior → null propaga (não usa 0)."},
  t06:{what:"Verifica PREV com dois inputs directos na mesma fórmula (sem calculada intermédia).",formulas:["v_acm  =  PREV(v_acm) + v_rec − v_cus"],steps:["Selecciona T06. Altera Receita Jan: 1 000 → 1 500.","Verifica cascata: Acm Jan=900, Fev=1400, Mar=1800."],ctx:"PT/Retalho · todos os períodos",rows:[{l:"Acm. Jan (v_acm)",b:"400",a:"900",t:"x"},{l:"Acm. Fev (v_acm)",b:"900",a:"1 400",t:"x"},{l:"Acm. Mar (v_acm)",b:"1 300",a:"1 800",t:"x"}],note:"Diferença de T05: acumula directamente v_rec−v_cus, sem variável intermédia."},
  t07:{what:"Verifica que SUM_LOBS agrega todos os LOBs de uma língua para um input.",formulas:["v_trc  =  SUM_LOBS(v_rec)"],steps:["Selecciona T07. Altera Receita PT/Retalho Jan: 1 000 → 1 300.","Observa Total Receita PT Jan: 3 000 → 3 300.","Altera EN e confirma que PT não é afectado."],ctx:"PT · Jan",rows:[{l:"Rec. PT/Retalho",b:"1 000",a:"1 300",t:"i"},{l:"Total Receita PT",b:"3 000",a:"3 300",t:"x"}],note:"SUM_LOBS usa ctx.lid — alteração em PT não contamina EN."},
  t08:{what:"Verifica expressão com SUM_LOBS() como numerador e denominador.",formulas:["v_eff  =  SUM_LOBS(v_mar) / SUM_LOBS(v_rec) × 100"],steps:["Selecciona T08. Altera Receita PT/Retalho Jan: 1 000 → 1 500.","Eficiência PT Jan: 40% → 48,57%."],ctx:"PT · Jan",rows:[{l:"∑ Margem PT",b:"1 200",a:"1 700",t:"x"},{l:"∑ Receita PT",b:"3 000",a:"3 500",t:"x"},{l:"Eficiência %",b:"40,00 %",a:"48,57 %",t:"x"}],note:"Dois nós SumL distintos na mesma AST — avaliados independentemente."},
  t09:{what:"Verifica referência directa a input do mesmo scope na fórmula.",formulas:["v_dev  =  SUM_LOBS(v_mar) − v_bgt"],steps:["Selecciona T09. Altera Budget PT Jan: 400 → 700.","Desvio PT Jan: 800 → 500."],ctx:"PT · Jan",rows:[{l:"Budget PT (v_bgt)",b:"400",a:"700",t:"i"},{l:"Desvio PT (v_dev)",b:"800",a:"500",t:"x"}],note:"v_bgt tem scope=language — instância por língua, isolado por ctx.lid."},
  t10:{what:"Verifica que SUM_LANGS agrega todas as línguas para o scope Projeto.",formulas:["v_gbl = SUM_LANGS(v_tot)","v_tgr = SUM_LANGS(v_trc)"],steps:["Selecciona T10. Altera Receita de qualquer LOB.","Observa a cadeia LOB → Língua → Projeto."],ctx:"Projeto · Jan",rows:[{l:"Total Margem PT",b:"1 200",a:"1 700",t:"x"},{l:"Margem Global",b:"1 400",a:"1 900",t:"x"}],note:"SUM_LANGS ocorre depois de todas as fases Língua — valores já calculados."},
  t11:{what:"Verifica referência a input de scope Projeto (análogo a T09 no nível Projeto).",formulas:["v_gap  =  SUM_LANGS(v_tot) − v_tgt"],steps:["Selecciona T11. Altera Target Jan: 700 → 900.","Gap Jan: 700 → 500. Nenhuma outra variável muda."],ctx:"Projeto · Jan",rows:[{l:"Target  (v_tgt)",b:"700",a:"900",t:"i"},{l:"Gap vs. Target",b:"700",a:"500",t:"x"}],note:"v_tgt tem scope=template — instância única. Alteração afecta apenas v_gap."},
  t12:{what:"Teste de integração — propagação completa desde input LOB até ao topo.",formulas:["v_rec → LOB (8 vars) → Língua (4 vars) → Projeto (4 vars)"],steps:["Selecciona T12. Altera Receita PT/Retalho Jan: 1 000 → 1 300.","Conta os números de sequência → expectativa: 15 variáveis numeradas.","v_gmg e v_gap (topo) devem estar a laranja."],ctx:"Toda a hierarquia",rows:[{l:"Rec. PT/Ret (v_rec)",b:"1 000",a:"1 300",t:"i"},{l:"Margem Global %",b:"40,00 %",a:"42,50 %",t:"x"},{l:"Gap vs. Target",b:"700",a:"1 000",t:"x"}],note:"15 variáveis a laranja validam o motor end-to-end."},
  t13:{
    what:"Verifica que uma variável pode ter fórmulas distintas consoante o último input editado. O mecanismo @ selecciona a fórmula em runtime com base no activeTriggerId guardado na célula.",
    formulas:[
      "@ v_prz  :  v_mar − v_mar × v_prz / 100   (margem com penalidade de prazo)",
      "@ v_vol  :  v_mar × v_vol / 50             (margem escalonada por volume)",
      "default  :  v_mar                           (sem trigger activo)",
    ],
    steps:[
      "Selecciona T13. Dois inputs ficam a verde: Prazo médio (v_prz) e Volume (v_vol).",
      "Edita Prazo PT/Retalho Jan: 30 → 60. Result. Ajustado muda para v_mar−v_mar×60/100 = 400−240 = 160. A célula fica a violeta.",
      "Edita agora Volume PT/Retalho Jan: 50 → 100. Result. Ajustado muda para v_mar×100/50 = 800. O trigger activo muda de v_prz para v_vol.",
      "Hover na célula violeta → tooltip mostra qual trigger está activo e a fórmula em uso.",
      "Verifica que os outros períodos (Fev, Mar) também actualizaram com o novo trigger.",
    ],
    ctx:"PT/Retalho · Jan",
    rows:[
      {l:"Prazo médio (v_prz)",b:"30",a:"60",t:"i"},
      {l:"Margem      (v_mar)",b:"400",a:"400",t:"c"},
      {l:"Result. Aj. — trigger v_prz",b:"400 (default)",a:"160",t:"x"},
      {l:"--- depois edita Volume ---",b:"",a:"",t:"c"},
      {l:"Volume (v_vol)",b:"50",a:"100",t:"i"},
      {l:"Result. Aj. — trigger v_vol",b:"160",a:"800",t:"x"},
    ],
    note:"O trigger não muda sozinho — só muda quando o utilizador edita um input que é trigger desta variável. Editar v_rec ou v_cus não altera o trigger activo; apenas actualiza v_mar que é usado pela fórmula já activa.",
  },
  t14:{
    what:"Verifica o mecanismo de referências absolutas com qualificadores [lang][lob]. Uma fórmula pode fixar a língua e/ou o LOB de uma referência, independentemente do contexto da célula que está a ser calculada — equivalente a uma referência absoluta no Excel.",
    formulas:[
      "v_idx  =  v_rec / v_rec[PT][ret] * 100      (LOB scope — base PT/Retalho)",
      "v_dif  =  v_tot − v_tot[PT]                 (Language scope — desvio vs PT)",
      "v_cmp  =  v_tot[PT] / v_tot[EN] * 100       (Template scope — rácio PT/EN)",
    ],
    steps:[
      "Selecciona T14. A variável Receita (v_rec) fica a verde.",
      "Valores iniciais: v_idx PT/Ret=100, PT/Emp=200, EN/Retail=50 | v_dif PT=0, EN=−1000 | v_cmp=600.",
      "Altera Receita PT/Retalho Jan: 1 000 → 1 500.",
      "v_idx PT/Ret continua 100 (é o denominador dela própria). v_idx PT/Emp=133,33. v_idx EN=33,33.",
      "v_cmp muda: v_tot[PT] aumenta → rácio PT/EN aumenta.",
      "v_dif PT mantém 0 (v_tot − v_tot[PT] = self−self). v_dif EN torna-se mais negativo.",
    ],
    ctx:"PT/Retalho · Jan (dados iniciais)",
    rows:[
      {l:"v_rec PT/Retalho",b:"1 000",a:"1 500",t:"i"},
      {l:"v_idx PT/Retalho  (self/self×100)",b:"100,00",a:"100,00",t:"c"},
      {l:"v_idx PT/Empresas (2000/1000×100)",b:"200,00",a:"133,33",t:"x"},
      {l:"v_idx EN/Retail   (500/1000×100)", b:"50,00", a:"33,33", t:"x"},
      {l:"v_dif PT  (tot_PT−tot_PT)",        b:"0,00",  a:"0,00",  t:"c"},
      {l:"v_dif EN  (tot_EN−tot_PT)",        b:"−1 000",a:"−1 500",t:"x"},
      {l:"v_cmp    (tot_PT/tot_EN×100)",     b:"600,00",a:"850,00",t:"x"},
    ],
    note:"Editar Receita de EN/Retail não afecta v_idx PT/Emp nem v_dif PT — as referências absolutas isolam os contextos. É o comportamento-chave a validar: [PT][ret] aponta sempre para a mesma célula independentemente de onde a fórmula está a ser avaliada.",
  },
}

/* ═══════════════════════════════════════════════════════════════
   SCOPE CONFIG
   ═══════════════════════════════════════════════════════════════ */

const SC = {
  lob:      { label: "LOB",     badge: "bg-sky-100 text-sky-700",          bg: "bg-sky-50/40" },
  language: { label: "Língua",  badge: "bg-emerald-100 text-emerald-700",  bg: "bg-emerald-50/40" },
  project: { label: "Projeto", badge: "bg-amber-100 text-amber-700",      bg: "bg-amber-50/40" },
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function OrderBadge({ n }) {
  if (n == null) return null
  return (
    <div className={`absolute top-0 right-0 flex items-center justify-center rounded-full bg-indigo-500 text-white font-bold leading-none shadow-md border-2 border-white z-10 ${n > 9 ? "min-w-[22px] h-[18px] px-1 text-[9px]" : "w-[18px] h-[18px] text-[10px]"}`}>
      {n}
    </div>
  )
}

function EditableCell({ value, onChange, dirty, toEdit, locked }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  // Célula bloqueada — mostra valor sem interacção
  if (locked) return (
    <div className="relative px-3 py-2 text-right text-sm font-mono text-gray-400 cursor-not-allowed select-none"
         title={locked === "past" ? "Período passado — não editável" : "Versão bloqueada — não editável"}>
      {value != null
        ? <span>{fmtV(value)}</span>
        : <span className="text-gray-200 text-xs font-sans">—</span>
      }
      <span className="absolute top-0.5 right-0.5 text-[8px] text-gray-300">🔒</span>
    </div>
  )

  if (editing) return (
    <input className="w-full px-3 py-2 text-right text-sm bg-sky-50 border-2 border-sky-400 outline-none font-mono"
      value={draft} autoFocus onChange={e => setDraft(e.target.value)}
      onBlur={() => { const n = parseFloat(draft.replace(",", ".")); onChange(isNaN(n) ? null : n); setEditing(false) }}
      onKeyDown={e => { if (e.key === "Enter") { const n = parseFloat(draft.replace(",", ".")); onChange(isNaN(n) ? null : n); setEditing(false) } if (e.key === "Escape") setEditing(false) }}
    />
  )
  const bg = dirty ? "bg-orange-100 hover:bg-orange-200/70" : toEdit ? "bg-green-50 hover:bg-green-100/70" : "hover:bg-white/80"
  return (
    <div onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true) }}
      className={`relative px-3 py-2 text-right text-sm font-mono cursor-pointer transition-all group ${bg}`}>
      {dirty  && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400" />}
      {!dirty && toEdit && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {value != null
        ? <span className={dirty ? "text-orange-800 font-semibold" : toEdit ? "text-green-800 font-semibold" : "text-gray-800"}>{fmtV(value)}</span>
        : <span className="text-gray-300 text-xs font-sans opacity-0 group-hover:opacity-100">—</span>
      }
    </div>
  )
}

function CalcCell({ value, formula, altFormula, activeTriggerId, dirty, status }) {
  const [tip, setTip] = useState(false)
  const displayFm = altFormula ?? formula
  const isCircular = status === "circular"
  const isErr = !isCircular && value === null && displayFm != null
  return (
    <div onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}
      className={`relative px-3 py-2 text-right text-sm font-mono select-none transition-all ${dirty ? "bg-orange-50" : ""}`}>
      {dirty && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400" />}
      {isCircular
        ? <span className="text-purple-600 text-xs font-sans font-bold" title="Dependência circular">CIRC</span>
        : isErr
        ? <span className="text-red-500 text-xs font-sans font-semibold">ERR</span>
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

function DeltaCell({ valueA, valueB }) {
  if (valueA == null || valueB == null) {
    return <div className="px-2 py-2 text-center text-gray-300 text-sm select-none font-mono">—</div>
  }
  const d = valueB - valueA
  if (!isFinite(d)) return <div className="px-2 py-2 text-center text-red-400 text-xs font-sans select-none">ERR</div>
  if (Math.abs(d) < 0.005) return <div className="px-2 py-2 text-right text-sm font-mono text-gray-400 select-none">0</div>
  const pos = d > 0
  return (
    <div className={`px-2 py-2 text-right text-sm font-mono font-semibold select-none ${pos ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
      {pos ? "+" : ""}{fmtV(d)}
    </div>
  )
}

function Badge({ scope }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SC[scope].badge}`}>{SC[scope].label}</span>
}

/* ── Version Tab ────────────────────────────────────────────── */


/* ═══════════════════════════════════════════════════════════════
   TEMPLATE MODAL — define o template: nome, descrição e variáveis
   ═══════════════════════════════════════════════════════════════ */

function TemplateModal({ initialTemplateId, onClose, onEditVar, onAddVar }) {
  const [allTemplates, setAllTemplates] = useState([])
  const [activeId,     setActiveId]     = useState(initialTemplateId ?? null)
  const [vars,         setVars]         = useState([])
  const [name,         setName]         = useState("")
  const [desc,         setDesc]         = useState("")
  const [loading,      setLoading]      = useState(true)
  const [loadingVars,  setLoadingVars]  = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [deleting,     setDeleting]     = useState(false)

  // Load all templates on mount
  useEffect(() => {
    api.get('/admin/templates')
      .then(tpls => {
        setAllTemplates(tpls)
        const first = initialTemplateId
          ? tpls.find(t => t.templateId === initialTemplateId)
          : tpls[0]
        if (first) {
          setActiveId(first.templateId)
          setName(first.name)
          setDesc(first.description ?? "")
        }
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [])

  // Load variables when active template changes
  useEffect(() => {
    if (!activeId) return
    setLoadingVars(true)
    api.get(`/templates/${activeId}/variables`)
      .then(data => {
        const apiVars = data ?? []
        setVars(apiVars.map(v => ({
          id: v.code,
          name: v.name,
          scope: v.scopeCode,
          isInput: v.isInput,
          formula: v.formulas?.find(f => f.formulaType === "main")?.expression ?? null,
          alternatives: (v.formulas ?? []).filter(f => f.formulaType === "alternative").length,
          _apiId: v.variableId
        })))
      })
      .catch(e => console.error(e))
      .finally(() => setLoadingVars(false))
  }, [activeId])

  const switchTemplate = (idStr) => {
    const id = parseInt(idStr)
    const tpl = allTemplates.find(t => t.templateId === id)
    if (!tpl) return
    setActiveId(id)
    setName(tpl.name)
    setDesc(tpl.description ?? "")
    setVars([])
  }

  const handleSave = async () => {
    if (!activeId || !name.trim()) return
    setSaving(true)
    try {
      const updated = await api.put(`/admin/templates/${activeId}`, { code: "", name: name.trim(), description: desc })
      setAllTemplates(prev => prev.map(t => t.templateId === activeId ? {...t, name: updated.name, description: updated.description} : t))
    } catch(e) { alert('Erro ao guardar: ' + e.message) }
    finally { setSaving(false) }
  }

  const handleNew = async () => {
    try {
      const created = await api.post('/admin/templates', { code: `tpl_${Date.now()}`, name: "Novo Template", description: "" })
      setAllTemplates(prev => [...prev, created])
      setActiveId(created.templateId)
      setName(created.name)
      setDesc(created.description ?? "")
      setVars([])
    } catch(e) { alert('Erro ao criar: ' + e.message) }
  }

  const handleDelete = async () => {
    try {
      await api.delete(`/admin/templates/${activeId}`)
      const remaining = allTemplates.filter(t => t.templateId !== activeId)
      setAllTemplates(remaining)
      if (remaining.length > 0) {
        const next = remaining[0]
        setActiveId(next.templateId)
        setName(next.name)
        setDesc(next.description ?? "")
        setVars([])
      } else {
        onClose()
      }
    } catch(e) { alert('Erro ao eliminar: ' + e.message) }
    finally { setDeleting(false) }
  }

  const activeTemplate = allTemplates.find(t => t.templateId === activeId)
  const scopeOrder = ["lob","language","project"]
  const grouped    = scopeOrder.map(s => ({ scope: s, vars: vars.filter(v => v.scope === s) }))

  const SC = {
    lob:      { label:"LOB",      bg:"bg-blue-50/40" },
    language: { label:"Language", bg:"bg-amber-50/40" },
    project:  { label:"Project",  bg:"bg-emerald-50/40" }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center text-white text-xs">∑</div>
            <h2 className="font-bold text-gray-800">Definição do Template</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl">×</button>
        </div>

        {/* Template navigator */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-3 shrink-0">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide shrink-0">Template</span>
          <div className="relative flex-1">
            <select value={activeId ?? ''} onChange={e=>switchTemplate(e.target.value)}
              disabled={loading}
              className="w-full pl-3 pr-8 py-1.5 border border-gray-200 rounded-lg text-sm bg-white
                         focus:outline-none focus:border-sky-400 appearance-none disabled:opacity-50">
              {allTemplates.map(t=>(
                <option key={t.templateId} value={t.templateId}>{t.name}</option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"
                 viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
            </svg>
          </div>
          <button onClick={handleNew}
            className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium shrink-0 transition-colors">
            + Novo
          </button>
          {activeId && (
            <button onClick={()=>setDeleting(true)}
              className="text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium shrink-0 transition-colors">
              Eliminar
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">A carregar...</div>
        ) : !activeId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Sem templates. Cria um novo.</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Nome do Template</label>
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-400"
                    placeholder="Template Standard"/>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Descrição</label>
                  <input value={desc} onChange={e => setDesc(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-400"
                    placeholder="Descrição opcional"/>
                </div>
              </div>

              {/* Scope badge + var count */}
              <div className="flex items-center gap-3">
                {grouped.filter(g=>g.vars.length>0).map(g=>(
                  <span key={g.scope} className="text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-100 font-medium">
                    {SC[g.scope]?.label ?? g.scope}
                  </span>
                ))}
                <span className="text-xs text-gray-400">
                  {loadingVars ? 'A carregar variáveis...' : `${vars.length} variáveis`}
                </span>
              </div>

              {/* Variables by scope */}
              {loadingVars ? (
                <div className="text-sm text-gray-400 text-center py-4">A carregar...</div>
              ) : (
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {grouped.filter(g=>g.vars.length>0).map(({ scope, vars: sv }) => (
                    <div key={scope}>
                      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{SC[scope]?.label ?? scope}</span>
                        <span className="text-xs text-gray-300">{sv.length}</span>
                      </div>
                      {sv.map(v => {
                        const isInput = v.isInput
                        return (
                          <div key={v.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-gray-800">{v.name}</span>
                                <span className="text-xs font-mono text-gray-400">{v.id}</span>
                                {isInput
                                  ? <span className="text-xs bg-white px-1.5 py-0.5 rounded border border-gray-200 text-gray-500">input</span>
                                  : v.alternatives > 0
                                    ? <span className="text-xs bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200 text-violet-600">{v.alternatives} alt.</span>
                                    : null
                                }
                              </div>
                              {!isInput && v.formula && (
                                <p className="text-xs font-mono text-gray-400 mt-0.5 truncate" title={v.formula}>{v.formula}</p>
                              )}
                            </div>
                            <button onClick={() => onEditVar({
                                id:           v.id,
                                name:         v.name,
                                scope:        v.scope,
                                isInput:      v.isInput,
                                formula:      v.formula,
                                groupId:      v.groupId ?? null,
                                alternatives: v.alternatives ? Array(v.alternatives).fill({trigger:'',formula:''}) : [],
                                _apiId:       v._apiId,
                                templateId:   activeId
                              })}
                              className="text-gray-300 hover:text-sky-500 text-sm w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white transition-all shrink-0 opacity-0 group-hover:opacity-100">✎</button>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  {vars.length === 0 && !loadingVars && (
                    <p className="text-sm text-gray-400 text-center py-6">Sem variáveis. Adiciona a primeira.</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
              <button onClick={()=>onAddVar(activeId)}
                className="px-4 py-2 text-sm text-sky-600 hover:text-sky-800 font-semibold transition-colors">
                + Adicionar variável
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
                <button onClick={handleSave} disabled={saving||!name.trim()}
                  className="px-5 py-2 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors font-medium">
                  {saving ? 'A guardar...' : 'Guardar Template'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirm */}
      {deleting && (
        <>
          <div className="fixed inset-0 bg-black/20 z-[60]" onClick={()=>setDeleting(false)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-80 p-6 text-center">
            <p className="font-semibold text-gray-800 mb-1">Eliminar template?</p>
            <p className="text-sm text-gray-400 mb-5 truncate">{activeTemplate?.name}</p>
            <div className="flex gap-3">
              <button onClick={()=>setDeleting(false)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold">
                Eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════
   PROJECT LIST PANEL + PROJECT MODAL
   ═══════════════════════════════════════════════════════════════ */
function ProjectListPanel({ allProjects, templates, onEdit, onCreate, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(null)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={onClose}/>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                      bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-gray-100">

        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-sky-600 rounded-lg flex items-center justify-center text-white text-xs">🏢</div>
            <h2 className="font-bold text-gray-800">Projectos</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCreate}
              className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold transition-colors">
              + Novo
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {allProjects.map(p => {
            const tpl = templates.find(t => t.id === `tpl_${p.templateId}`)
            return (
              <div key={p.projectId}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-gray-800 truncate block">{p.name}</span>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">Template: {tpl?.name ?? `#${p.templateId}`}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>onEdit(p.projectId)}
                    className="text-xs px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg font-medium transition-colors">
                    Editar
                  </button>
                  <button onClick={()=>setConfirmDelete(p)}
                    className="text-xs px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium transition-colors">
                    Eliminar
                  </button>
                </div>
              </div>
            )
          })}
          {allProjects.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Sem projectos criados.</p>
          )}
        </div>
      </div>

      {confirmDelete && (
        <>
          <div className="fixed inset-0 bg-black/20 z-[60]" onClick={()=>setConfirmDelete(null)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-80 p-6 text-center">
            <p className="font-semibold text-gray-800 mb-1">Eliminar projecto?</p>
            <p className="text-sm text-gray-400 mb-1 truncate">{confirmDelete.name}</p>
            <p className="text-xs text-red-400 mb-5">Todas as versões e células serão eliminadas.</p>
            <div className="flex gap-3">
              <button onClick={()=>setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={()=>{ onDelete(confirmDelete.projectId); setConfirmDelete(null) }}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold">
                Eliminar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function ProjectModal({ project, templates: templatesProp, isNew, onSave, onClose }) {
  const [name,       setName]       = useState(project?.name ?? '')
  const [templateId, setTemplateId] = useState(project?.templateId ?? '')
  const [langs,      setLangs]      = useState(() =>
    (project?.languages ?? []).map(l => ({ ...l, lobs: (l.lobs ?? []).map(b => ({ ...b })) }))
  )
  const [expandedLangs, setExpandedLangs] = useState(new Set((project?.languages ?? []).map(l => l.id)))
  const [errors,   setErrors]   = useState({})
  const [templates, setTemplates] = useState(templatesProp ?? [])
  const [loadingStruct, setLoadingStruct] = useState(false)
  const idCtr = useRef(1000)
  const newId  = prefix => `${prefix}_${String(idCtr.current++).padStart(3,"0")}`

  // Load templates from API if not provided
  useEffect(() => {
    if (!templatesProp?.length) {
      api.get('/admin/templates')
        .then(tpls => setTemplates(tpls.map(t => ({ id: `tpl_${t.templateId}`, name: t.name }))))
        .catch(e => console.error(e))
    }
  }, [])

  // Load project structure from API for non-active projects
  useEffect(() => {
    if (!isNew && project?.id && (!project.languages || project.languages.length === 0)) {
      const rawId = parseInt((project.id ?? '').replace('c_',''))
      if (!rawId) return
      setLoadingStruct(true)
      api.get(`/projects/${rawId}/structure`)
        .then(data => {
          const ls = (data.languages ?? []).map(l => ({
            id: `l_${l.languageId}`, code: l.code, name: l.name,
            lobs: (l.lobs ?? []).map(b => ({ id: `b_${b.lobId}`, code: b.code, name: b.name }))
          }))
          setLangs(ls)
          setExpandedLangs(new Set(ls.map(l => l.id)))
        })
        .catch(e => console.error('Load structure:', e))
        .finally(() => setLoadingStruct(false))
    }
  }, [project?.id])

  const templateChanged = templateId !== project?.templateId
  const selectedTpl     = templates.find(t => t.id === templateId)

  const addLang    = () => { const id=newId("l"); setLangs(p=>[...p,{id,code:"",name:"",lobs:[]}]); setExpandedLangs(p=>new Set([...p,id])) }
  const removeLang = id => { setLangs(p=>p.filter(l=>l.id!==id)); setExpandedLangs(p=>{const n=new Set(p);n.delete(id);return n}) }
  const updateLang = (id,f,v) => setLangs(p=>p.map(l=>l.id===id?{...l,[f]:v}:l))
  const toggleLang = id => setExpandedLangs(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const addLob    = lid => setLangs(p=>p.map(l=>l.id===lid?{...l,lobs:[...l.lobs,{id:newId("b"),code:"",name:""}]}:l))
  const removeLob = (lid,bid) => setLangs(p=>p.map(l=>l.id===lid?{...l,lobs:l.lobs.filter(b=>b.id!==bid)}:l))
  const updateLob = (lid,bid,f,v) => setLangs(p=>p.map(l=>l.id===lid?{...l,lobs:l.lobs.map(b=>b.id===bid?{...b,[f]:v}:b)}:l))

  const validate = () => {
    const e = {}
    if (!name.trim())  e.name = "Obrigatório"
    if (!templateId)   e.tpl  = "Selecciona um template"
    langs.forEach((l,li) => {
      if (!l.code.trim()) e[`lc${li}`] = "Obrigatório"
      if (!l.name.trim()) e[`ln${li}`] = "Obrigatório"
      l.lobs.forEach((b,bi) => {
        if (!b.code.trim()) e[`bc${li}${bi}`] = "Obrigatório"
        if (!b.name.trim()) e[`bn${li}${bi}`] = "Obrigatório"
      })
    })
    setErrors(e); return Object.keys(e).length === 0
  }

  const handleSave = () => { if (validate()) onSave({ ...(project ?? {}), name:name.trim(), templateId, languages:langs }) }

  const inp = (val, onChange, placeholder, ek, cls="") => (
    <input value={val} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      className={`border rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 bg-white transition-colors
        ${errors[ek]?"border-red-300":"border-gray-200"} ${cls}`}/>
  )

  const removedLangs = (project?.languages ?? []).filter(l=>!langs.find(nl=>nl.id===l.id)).length
  const removedLobs  = (project?.languages ?? []).flatMap(l=>l.lobs ?? []).filter(b=>!langs.flatMap(l=>l.lobs).find(nb=>nb.id===b.id)).length

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-gray-100">

        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {!isNew && (
              <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 hover:bg-gray-100 px-2 py-1 rounded-lg">
                ← Lista
              </button>
            )}
            <div className="w-7 h-7 bg-sky-600 rounded-lg flex items-center justify-center text-white text-xs">🏢</div>
            <h2 className="font-bold text-gray-800">{isNew ? 'Novo Projecto' : 'Configuração do Projecto'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Nome do Projecto</label>
              {inp(name, setName, "Acme Corp", "name", "w-full")}
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Template associado</label>
              <div className="relative">
                <select value={templateId} onChange={e=>setTemplateId(e.target.value)}
                  className={`w-full border rounded-lg pl-3 pr-8 py-2 text-sm outline-none focus:border-sky-400 bg-white appearance-none
                    ${errors.tpl?"border-red-300":"border-gray-200"}`}>
                  <option value="">— selecciona —</option>
                  {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
              </div>
              {errors.tpl && <p className="text-red-500 text-xs mt-1">{errors.tpl}</p>}
            </div>
          </div>

          {templateChanged && !isNew && (
            <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-amber-500 shrink-0">⚠</span>
              <p className="text-sm text-amber-800">Mudar o template irá repor todos os valores.</p>
            </div>
          )}

          {loadingStruct && (
            <p className="text-sm text-gray-400 text-center py-4">A carregar estrutura...</p>
          )}

          {(removedLangs > 0 || removedLobs > 0) && (
            <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-red-500 shrink-0">⚠</span>
              <p className="text-sm text-red-800">
                {removedLangs > 0 && `${removedLangs} língua(s)`}
                {removedLangs > 0 && removedLobs > 0 && " e "}
                {removedLobs > 0 && `${removedLobs} LOB(s)`}
                {" removidos — os valores correspondentes serão apagados."}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Línguas & LOBs</label>
              <button onClick={addLang} className="text-xs text-sky-600 hover:text-sky-800 font-semibold">+ Língua</button>
            </div>
            {langs.map((l, li) => (
              <div key={l.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
                  <button onClick={()=>toggleLang(l.id)} className="text-gray-400 hover:text-gray-600 text-xs w-5">
                    {expandedLangs.has(l.id) ? '▾' : '▸'}
                  </button>
                  {inp(l.code, v=>updateLang(l.id,'code',v), "Código", `lc${li}`, "w-20 font-mono")}
                  {inp(l.name, v=>updateLang(l.id,'name',v), "Nome da língua", `ln${li}`, "flex-1")}
                  <button onClick={()=>removeLang(l.id)} className="text-red-400 hover:text-red-600 text-lg leading-none ml-1">×</button>
                </div>
                {expandedLangs.has(l.id) && (
                  <div className="p-3 space-y-2">
                    {l.lobs.map((b, bi) => (
                      <div key={b.id} className="flex items-center gap-2 pl-6">
                        <span className="text-gray-300 text-xs">└</span>
                        {inp(b.code, v=>updateLob(l.id,b.id,'code',v), "Cód.", `bc${li}${bi}`, "w-20 font-mono")}
                        {inp(b.name, v=>updateLob(l.id,b.id,'name',v), "Nome do LOB", `bn${li}${bi}`, "flex-1")}
                        <button onClick={()=>removeLob(l.id,b.id)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                      </div>
                    ))}
                    <button onClick={()=>addLob(l.id)} className="text-xs text-gray-400 hover:text-gray-600 pl-6 font-medium">+ LOB</button>
                  </div>
                )}
              </div>
            ))}
            {langs.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-3">Sem línguas. Adiciona a primeira.</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={handleSave}
            className="px-5 py-2 bg-sky-600 text-white text-sm rounded-xl hover:bg-sky-700 transition-colors font-semibold">
            {isNew ? 'Criar Projecto' : 'Guardar Projecto'}
          </button>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════
   VAR MODAL — criar / editar variável
   ═══════════════════════════════════════════════════════════════ */
function VarModal({ variable, variables, client, onSave, onClose, onDelete }) {
  // variable = null (new) or { id, name, scope, isInput, formula, alternatives, groupId, _apiId, templateId }
  const isNew  = !variable
  const SCOPES = ['lob','language','project']

  const [name,         setName]        = useState(variable?.name         ?? '')
  const [code,         setCode]        = useState(variable?.id           ?? '')
  const [scope,        setScope]       = useState(variable?.scope        ?? 'lob')
  const [isInput,      setIsInput]     = useState(variable?.isInput      ?? false)
  const [formula,      setFormula]     = useState(variable?.formula      ?? '')
  const [groupId,      setGroupId]     = useState(variable?.groupId      ?? null)
  const [altList,      setAltList]     = useState(() =>
    (variable?.alternatives ?? []).map?.((a,i) => typeof a === 'object'
      ? { ...a, _key: i }
      : { trigger:'', formula:'', _key: i }
    ) ?? []
  )
  const [groups,       setGroups]      = useState([])
  const [errors,       setErrors]      = useState({})

  // Load variable groups for the template
  useEffect(() => {
    const tplId = variable?.templateId ?? (client ? parseInt((client.templateId ?? '').replace('tpl_','')) : null)
    if (!tplId) {
      // Load all groups
      api.get('/admin/groups')
        .then(g => setGroups(g))
        .catch(() => {})
    } else {
      api.get(`/admin/templates/${tplId}/groups`).catch(() => api.get('/admin/groups'))
        .then(g => setGroups(Array.isArray(g) ? g : []))
        .catch(() => {})
    }
  }, [])

  const addAlt    = () => setAltList(p => [...p, { trigger:'', formula:'', _key: Date.now() }])
  const removeAlt = k  => setAltList(p => p.filter(a => a._key !== k))
  const updateAlt = (k,f,v) => setAltList(p => p.map(a => a._key===k ? {...a,[f]:v} : a))

  const validate = () => {
    const e = {}
    if (!name.trim())  e.name  = 'Obrigatório'
    if (!code.trim())  e.code  = 'Obrigatório'
    if (!isInput && !formula.trim() && altList.length === 0) e.formula = 'Obrigatório para variáveis calculadas'
    altList.forEach((a,i) => {
      if (!a.trigger.trim()) e[`at${i}`] = 'Obrigatório'
      if (!a.formula.trim()) e[`af${i}`] = 'Obrigatório'
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    const saved = {
      id:           code.trim(),
      name:         name.trim(),
      scope,
      isInput,
      formula:      isInput ? null : (formula.trim() || null),
      groupId:      groupId ? parseInt(groupId) : null,
      alternatives: isInput ? [] : altList.map(a => ({ trigger: a.trigger.trim(), formula: a.formula.trim() })),
      _apiId:       variable?._apiId ?? null,
      templateId:   variable?.templateId ?? null,
    }
    onSave(saved)
  }

  const inp = (val, onChange, placeholder, ek, cls='') => (
    <input value={val} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      className={`border rounded-xl px-3 py-2 text-sm outline-none focus:border-sky-400 bg-white transition-colors
        ${errors[ek]?'border-red-300 bg-red-50':'border-gray-200'} ${cls}`}/>
  )

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center text-white text-xs">x</div>
            <h2 className="font-bold text-gray-800">{isNew ? 'Nova Variável' : 'Editar Variável'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Name + Code */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Nome <span className="text-red-400">*</span></label>
              {inp(name, setName, 'ex: Receita', 'name', 'w-full')}
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Código <span className="text-red-400">*</span></label>
              {inp(code, setCode, 'ex: v_rec', 'code', 'w-full font-mono')}
              {errors.code && <p className="text-red-500 text-xs mt-1">{errors.code}</p>}
            </div>
          </div>

          {/* Scope + Input */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Âmbito</label>
              <div className="relative">
                <select value={scope} onChange={e=>setScope(e.target.value)}
                  className="w-full pl-3 pr-8 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-sky-400 appearance-none">
                  {SCOPES.map(s => <option key={s} value={s}>{s === 'lob' ? 'LOB' : s === 'language' ? 'Language' : 'Project'}</option>)}
                </select>
                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
                </svg>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Grupo de variáveis</label>
              <div className="relative">
                <select value={groupId ?? ''} onChange={e=>setGroupId(e.target.value || null)}
                  className="w-full pl-3 pr-8 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-sky-400 appearance-none">
                  <option value="">— sem grupo —</option>
                  {groups.map(g => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}
                </select>
                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Input toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={isInput} onChange={e=>setIsInput(e.target.checked)}
              className="w-4 h-4 accent-sky-600"/>
            <span className="text-sm text-gray-700">Variável de input (valor introduzido pelo utilizador)</span>
          </label>

          {/* Formula */}
          {!isInput && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                Fórmula principal {altList.length === 0 && <span className="text-red-400">*</span>}
              </label>
              {inp(formula, setFormula, 'ex: v_rec - v_cus', 'formula', 'w-full font-mono')}
              {errors.formula && <p className="text-red-500 text-xs mt-1">{errors.formula}</p>}
            </div>
          )}

          {/* Alternatives */}
          {!isInput && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fórmulas alternativas</label>
                <button onClick={addAlt} className="text-xs text-sky-600 hover:text-sky-800 font-semibold">+ Adicionar</button>
              </div>
              {altList.map((a, i) => (
                <div key={a._key} className="grid grid-cols-[1fr_2fr_auto] gap-2 mb-2 items-start">
                  <div>
                    {inp(a.trigger, v=>updateAlt(a._key,'trigger',v), 'trigger (código)', `at${i}`, 'w-full font-mono')}
                    {errors[`at${i}`] && <p className="text-red-500 text-xs mt-0.5">{errors[`at${i}`]}</p>}
                  </div>
                  <div>
                    {inp(a.formula, v=>updateAlt(a._key,'formula',v), 'fórmula', `af${i}`, 'w-full font-mono')}
                    {errors[`af${i}`] && <p className="text-red-500 text-xs mt-0.5">{errors[`af${i}`]}</p>}
                  </div>
                  <button onClick={()=>removeAlt(a._key)}
                    className="text-red-400 hover:text-red-600 text-lg leading-none mt-1.5">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <div>
            {!isNew && onDelete && (
              <button onClick={onDelete}
                className="px-4 py-2 text-sm text-red-500 hover:text-red-700 font-medium">
                Eliminar variável
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
            <button onClick={handleSave}
              className="px-5 py-2 bg-violet-600 text-white text-sm rounded-xl hover:bg-violet-700 transition-colors font-semibold">
              {isNew ? 'Criar variável' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ── VersionMultiSelect ─────────────────────────────────────── */
/* ── DictModal ──────────────────────────────────────────────── */
function DictModal({ onClose, onLaunch }) {
  const [sel, setSel] = useState("t01")
  const d    = DICT[sel]
  const test = TESTS.find(t => t.id === sel)
  const rowCls = { i: "bg-white", c: "bg-gray-50 text-gray-400", x: "bg-orange-50" }
  const rowDot = {
    i: <span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>,
    c: null,
    x: <span className="w-2 h-2 rounded-full bg-orange-400 inline-block"/>
  }

  if (!d) return null

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs">📖</span>
            </div>
            <h2 className="font-bold text-gray-800 text-base">Guia de Testes</h2>
            <span className="text-xs text-gray-400">— descrição detalhada e exemplos numéricos</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl transition-colors">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-56 border-r border-gray-100 overflow-y-auto shrink-0 py-2">
            {TESTS.map(t => (
              <button key={t.id} onClick={() => setSel(t.id)}
                className={`w-full text-left px-4 py-2.5 transition-colors border-l-2
                  ${sel === t.id ? "border-sky-400 bg-sky-50 text-sky-700 font-semibold" : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700"}`}>
                <span className="text-xs font-mono block">{t.id.toUpperCase()}</span>
                <span className="text-xs leading-tight">{t.label.split(" · ")[1]}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">{sel.toUpperCase()}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{test?.label.split(" · ")[1]}</h3>
              </div>
              <button onClick={() => onLaunch(sel)}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition-colors font-semibold shrink-0 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse"/>
                Lançar teste ↗
              </button>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">O que testa</p>
              <p className="text-sm text-gray-700 leading-relaxed">{d.what}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Fórmulas envolvidas</p>
              <div className="space-y-1.5">
                {d.formulas.map((f, i) => (
                  <div key={i} className="bg-gray-900 text-emerald-400 font-mono text-sm px-4 py-2 rounded-lg">{f}</div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Como executar</p>
              <ol className="space-y-1.5">
                {d.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Exemplo numérico</p>
                <span className="text-xs text-gray-400">— {d.ctx}</span>
              </div>
              <div className="rounded-xl overflow-hidden border border-gray-200">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Variável</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Antes</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Depois</th>
                      <th className="px-3 py-2 w-8"/>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r, i) => (
                      <tr key={i} className={`border-b border-gray-100 last:border-0 ${rowCls[r.t]}`}>
                        <td className={`px-4 py-2 font-mono text-xs ${r.t==="c"?"text-gray-400":"text-gray-700"}`}>{r.l}</td>
                        <td className={`px-4 py-2 text-right font-mono text-sm ${r.t==="c"?"text-gray-400":"text-gray-600"}`}>{r.b}</td>
                        <td className={`px-4 py-2 text-right font-mono text-sm font-semibold ${r.t==="x"?"text-orange-700":r.t==="i"?"text-green-700":"text-gray-400"}`}>
                          {r.t!=="c"&&r.b!==r.a ? r.a : <span className="font-normal text-gray-400">{r.a}</span>}
                        </td>
                        <td className="px-3 py-2 text-center">{rowDot[r.t]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>Input a editar</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"/>Calculado que muda</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>Inalterado</span>
                </div>
              </div>
            </div>

            {d.note && (
              <div className="flex gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <span className="text-amber-500 shrink-0 mt-0.5">💡</span>
                <p className="text-sm text-amber-800 leading-relaxed">{d.note}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


function VersionMultiSelect({ versions, selectedIds, onToggle, onClear }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  const label = selectedIds.length === 0
    ? "Selecciona versões…"
    : selectedIds.length === 1
      ? (versions.find(v => v.id === selectedIds[0])?.name ?? "1 versão")
      : `${versions.find(v => v.id === selectedIds[0])?.name ?? ""} + ${selectedIds.length - 1}`

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-2 pl-3 pr-2.5 py-1.5 text-sm border rounded-xl bg-white transition-all min-w-52
          ${open ? "border-indigo-400 ring-2 ring-indigo-100" : "border-indigo-200 hover:border-indigo-300"}`}>
        <div className="flex items-center gap-0.5 shrink-0">
          {selectedIds.length === 0 && <span className="w-2 h-2 rounded-full bg-gray-300"/>}
          {selectedIds.slice(0, 5).map(id => {
            const ver = versions.find(v => v.id === id)
            const col = verColor(ver?.colorIdx ?? versions.findIndex(v => v.id === id))
            return <span key={id} className={`w-2 h-2 rounded-full ${col.dot}`}/>
          })}
        </div>
        <span className={`flex-1 text-left text-sm truncate ${selectedIds.length === 0 ? "text-gray-400" : "text-gray-700 font-medium"}`}>
          {label}
        </span>
        <svg className={`w-3.5 h-3.5 text-indigo-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 bg-white border border-gray-200 rounded-xl shadow-xl z-30 min-w-52 py-1 overflow-hidden">
          {versions.map((ver, idx) => {
            const checked = selectedIds.includes(ver.id)
            const pos     = selectedIds.indexOf(ver.id)
            const col     = verColor(ver.colorIdx ?? idx)
            return (
              <label key={ver.id}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none
                  ${checked ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(ver.id)}
                  className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"/>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`}/>
                <span className={`text-sm flex-1 ${checked ? "font-semibold text-indigo-700" : "text-gray-700"}`}>
                  {ver.name}
                </span>
                {checked && (
                  <span className="text-xs text-indigo-400 font-bold shrink-0">#{pos + 1}</span>
                )}
              </label>
            )
          })}
          {selectedIds.length > 0 && (
            <div className="border-t border-gray-100 mt-1 pt-1 px-4 py-1.5">
              <button onClick={() => { onClear(); setOpen(false) }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                Limpar selecção
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── VersionTab ─────────────────────────────────────────────── */
function VersionTab({ ver, colorIdx, isActive, onSelect, onClone, onRename, onDelete, canDelete }) {
  const [renaming, setRenaming] = useState(false)
  const [draft,    setDraft]    = useState(ver.name)
  const col = verColor(colorIdx)

  if (renaming) return (
    <div className="flex items-center px-2 py-2.5 border-b-2 border-transparent">
      <input autoFocus value={draft}
        className="border border-indigo-300 rounded px-2 py-0.5 text-sm w-28 outline-none focus:border-indigo-400 bg-white"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onRename(draft.trim() || ver.name); setRenaming(false) }}
        onKeyDown={e => {
          if (e.key === "Enter")  { onRename(draft.trim() || ver.name); setRenaming(false) }
          if (e.key === "Escape") { setDraft(ver.name); setRenaming(false) }
        }}
      />
    </div>
  )

  const lockBadge = ver.isLocked
    ? <span className="text-[10px] text-amber-500 ml-0.5">🔒</span>
    : null

  return (
    <div onClick={() => onSelect(ver.id)}
      className={`relative flex items-center gap-2 px-4 py-2.5 border-b-2 cursor-pointer transition-all whitespace-nowrap group select-none
        ${isActive ? `${col.active} font-semibold` : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200"}`}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`}/>
      <span className="text-sm">{ver.name}</span>
      {lockBadge}
      {isActive && (
        <div className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button title="Renomear" onClick={e => { e.stopPropagation(); setRenaming(true) }}
            className="text-gray-400 hover:text-gray-700 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-white/60 transition-colors">✎</button>
          <button title="Clonar" onClick={e => { e.stopPropagation(); onClone() }}
            className="text-gray-400 hover:text-gray-700 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-white/60 transition-colors">⎘</button>
          {canDelete && (
            <button title="Eliminar" onClick={e => { e.stopPropagation(); onDelete() }}
              className="text-red-400 hover:text-red-600 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 transition-colors">✕</button>
          )}
        </div>
      )}
    </div>
  )
}


function HamburgerMenu({ open, onClose, onTemplate, onProject, onDict, onAdmin }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose}/>
      <div className="fixed left-0 top-0 h-full w-64 bg-white shadow-2xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">∑</span>
            </div>
            <span className="font-bold text-gray-900 text-sm">Motor de Cálculo</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none">×</button>
        </div>
        <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Configuração</p>
          <button onClick={()=>{onTemplate();onClose()}}
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl text-left w-full transition-colors">
            <span className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">∑</span>
            Templates
          </button>
          <button onClick={()=>{onProject();onClose()}}
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl text-left w-full transition-colors">
            <span className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">🏢</span>
            Projectos
          </button>
          <button onClick={()=>{onAdmin();onClose()}}
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl text-left w-full transition-colors">
            <span className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">⚙️</span>
            Tipos de Versão e Grupos
          </button>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 mt-2">Ferramentas</p>
          <button onClick={()=>{onDict();onClose()}}
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl text-left w-full transition-colors">
            <span className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center">📖</span>
            Dicionário de Testes
          </button>
        </nav>
        <div className="p-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">Motor de Cálculo v1.0</p>
        </div>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════
   GRID FILTERS
   ═══════════════════════════════════════════════════════════════ */
function GridFilters({
  project,
  filterScope, setFilterScope,
  filterType,  setFilterType,
  filterLang,  setFilterLang,
  filterLob,   setFilterLob,
  filterVar,   setFilterVar,
  filterGroup, setFilterGroup,
  availableGroups
}) {
  const langs = project.languages ?? []
  const selectedLang = langs.find(l => l.code === filterLang)
  const lobs = filterLang && selectedLang ? selectedLang.lobs : langs.flatMap(l => l.lobs)

  // Quando muda o âmbito, limpa filtros de língua/lob que não fazem sentido
  const handleScopeChange = val => {
    setFilterScope(val)
    if (val === 'project') { setFilterLang(''); setFilterLob('') }
    if (val === 'language') { setFilterLob('') }
  }

  const hasFilters = filterScope || filterType || filterLang || filterLob || filterVar || filterGroup
  const clearAll   = () => { setFilterScope(''); setFilterType(''); setFilterLang(''); setFilterLob(''); setFilterVar(''); if(setFilterGroup) setFilterGroup('') }

  const scopeLabel = { template: 'Projecto', language: 'Língua', lob: 'LOB' }

  return (
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider shrink-0">Filtros</span>

      {/* Âmbito */}
      <select value={filterScope}
        onChange={e => handleScopeChange(e.target.value)}
        className={`text-xs px-2.5 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 cursor-pointer transition-colors
          ${filterScope ? 'border-violet-300 text-violet-700 bg-violet-50' : 'border-gray-200 text-gray-700'}`}>
        <option value="">Todos os âmbitos</option>
        <option value="project">Apenas Projecto</option>
        <option value="language">Apenas Língua</option>
        <option value="lob">Apenas LOB</option>
      </select>

      {/* Tipo: input vs calculada */}
      <select value={filterType}
        onChange={e => setFilterType(e.target.value)}
        className={`text-xs px-2.5 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 cursor-pointer transition-colors
          ${filterType === 'input'      ? 'border-cyan-300 text-cyan-700 bg-cyan-50'
          : filterType === 'calculated' ? 'border-gray-300 text-gray-600'
          : 'border-gray-200 text-gray-700'}`}>
        <option value="">Todos os tipos</option>
        <option value="input">✎ Apenas inputs</option>
        <option value="calculated">∑ Apenas calculadas</option>
      </select>

      {/* Língua — visível quando scope não é template */}
      {filterScope !== 'template' && (
        <select value={filterLang}
          onChange={e => { setFilterLang(e.target.value); setFilterLob('') }}
          className={`text-xs px-2.5 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 cursor-pointer transition-colors
            ${filterLang ? 'border-sky-300 text-sky-700 bg-sky-50' : 'border-gray-200 text-gray-700'}`}>
          <option value="">Todas as línguas</option>
          {langs.map(l => <option key={l.id} value={l.code}>{l.code} — {l.name}</option>)}
        </select>
      )}

      {/* LOB — visível quando scope é lob ou vazio */}
      {(filterScope === '' || filterScope === 'lob') && (
        <select value={filterLob}
          onChange={e => setFilterLob(e.target.value)}
          className={`text-xs px-2.5 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 cursor-pointer transition-colors
            ${filterLob ? 'border-indigo-300 text-indigo-700 bg-indigo-50' : 'border-gray-200 text-gray-700'}`}>
          <option value="">Todos os LOBs</option>
          {lobs.map(b => <option key={b.id} value={b.code}>{b.code} — {b.name}</option>)}
        </select>
      )}

      {/* Variável */}
      <input value={filterVar}
        onChange={e => setFilterVar(e.target.value)}
        placeholder="Filtrar variável..."
        className={`text-xs px-3 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 w-36 transition-colors
          ${filterVar ? 'border-amber-300 text-amber-700 bg-amber-50' : 'border-gray-200 text-gray-700'}`}/>

      {/* Grupo */}
      {availableGroups?.length > 0 && (
        <select value={filterGroup||''} onChange={e=>setFilterGroup&&setFilterGroup(e.target.value)}
          className={`text-xs px-2.5 py-1.5 border rounded-lg bg-white outline-none focus:border-sky-400 cursor-pointer transition-colors
            ${filterGroup ? 'border-teal-300 text-teal-700 bg-teal-50' : 'border-gray-200 text-gray-700'}`}>
          <option value="">Todos os grupos</option>
          {availableGroups.map(g=>(
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}

      {/* Tags activas */}
      {filterType === 'input'      && <span className="text-xs px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded-full font-medium">✎ Inputs</span>}
      {filterType === 'calculated' && <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">∑ Calculadas</span>}
      {filterScope && <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-medium">{scopeLabel[filterScope]}</span>}
      {filterLang  && <span className="text-xs px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full font-medium">{filterLang}</span>}
      {filterLob   && <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">{filterLob}</span>}
      {filterVar   && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">"{filterVar}"</span>}
      {filterGroup && availableGroups && <span className="text-xs px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full font-medium">{availableGroups.find(g=>g.id===filterGroup)?.name ?? filterGroup}</span>}

      {hasFilters && (
        <button onClick={clearAll}
          className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors ml-1">
          × Limpar
        </button>
      )}
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════
   PERIOD RANGE HELPERS
   ═══════════════════════════════════════════════════════════════ */

// Gera array de YYYYMM entre start e end (inclusive)
const generatePeriods = (start, end) => {
  const result = []
  let cur = start
  while (cur <= end && result.length < 120) {  // max 10 anos
    result.push(cur)
    const y = Math.floor(cur / 100), m = cur % 100
    cur = m === 12 ? (y + 1) * 100 + 1 : y * 100 + (m + 1)
  }
  return result
}

const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// Converte YYYYMM → { year, month }
const parsePeriod = p => ({ year: Math.floor(p / 100), month: p % 100 })

// Devolve o YYYYMM do primeiro período visível dado pageOffset e pageSize
const firstVisiblePeriod = (allPeriods, pageOffset, pageSize) =>
  allPeriods[pageOffset * pageSize] ?? allPeriods[0]

/* ═══════════════════════════════════════════════════════════════
   PERIOD RANGE SELECTOR — selecção do intervalo e página visível
   ═══════════════════════════════════════════════════════════════ */
function PeriodRangeSelector({ rangeStart, rangeEnd, setRangeStart, setRangeEnd,
                                pageSize, setPageSize, pageOffset, setPageOffset,
                                allPeriods, visiblePeriods }) {
  const totalPages = Math.ceil(allPeriods.length / pageSize)
  const canPrev = pageOffset > 0
  const canNext = pageOffset < totalPages - 1

  const curYear = new Date().getFullYear()
  const YEARS = Array.from({ length: 10 }, (_, i) => curYear - 2 + i)

  const sel = "text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-sky-400 cursor-pointer"

  const startY = Math.floor(rangeStart / 100), startM = rangeStart % 100
  const endY   = Math.floor(rangeEnd   / 100), endM   = rangeEnd   % 100

  const setStart = (y, m) => { const p = y * 100 + m; if (p <= rangeEnd) { setRangeStart(p); setPageOffset(0) } }
  const setEnd   = (y, m) => { const p = y * 100 + m; if (p >= rangeStart) { setRangeEnd(p); setPageOffset(0) } }

  // Rótulo da janela visível
  const winLabel = visiblePeriods.length > 0
    ? visiblePeriods.length === 1
      ? fmtP(visiblePeriods[0])
      : `${fmtP(visiblePeriods[0])} — ${fmtP(visiblePeriods[visiblePeriods.length - 1])}`
    : ''

  return (
    <div className="flex items-center gap-2 shrink-0 flex-wrap">
      {/* Intervalo */}
      <div className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-xl">
        <span className="text-xs text-gray-400 shrink-0">De</span>
        <select value={startM} onChange={e=>setStart(startY, parseInt(e.target.value))} className={sel}>
          {MONTHS_PT.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <select value={startY} onChange={e=>setStart(parseInt(e.target.value), startM)} className={sel}>
          {YEARS.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <span className="text-xs text-gray-400 px-1 shrink-0">até</span>
        <select value={endM} onChange={e=>setEnd(endY, parseInt(e.target.value))} className={sel}>
          {MONTHS_PT.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <select value={endY} onChange={e=>setEnd(parseInt(e.target.value), endM)} className={sel}>
          {YEARS.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Tamanho da janela */}
      <div className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-xl">
        <span className="text-xs text-gray-400 shrink-0">Mostrar</span>
        <select value={pageSize} onChange={e=>{setPageSize(parseInt(e.target.value));setPageOffset(0)}} className={sel}>
          <option value={1}>1 mês</option>
          <option value={3}>3 meses</option>
          <option value={6}>6 meses</option>
          <option value={12}>12 meses</option>
          <option value={999}>Todos</option>
        </select>
      </div>

      {/* Navegação entre páginas */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded-xl">
          <button onClick={()=>setPageOffset(p=>p-1)} disabled={!canPrev}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold">
            ‹
          </button>
          <span className="text-xs text-gray-600 font-medium px-1 min-w-28 text-center">{winLabel}</span>
          <button onClick={()=>setPageOffset(p=>p+1)} disabled={!canNext}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-bold">
            ›
          </button>
          <span className="text-xs text-gray-400 ml-1">{pageOffset+1}/{totalPages}</span>
        </div>
      )}
    </div>
  )
}



/* ═══════════════════════════════════════════════════════════════
   DELTA LOG MODAL — Sequência de cálculo
   ═══════════════════════════════════════════════════════════════ */
function DeltaLogModal({ entries, onClose }) {
  if (!entries.length) return null
  const fmt = v => v == null ? "—" : Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 4 })
  const calcCount = new Set(entries.filter(e => !e.isEdited).map(e => e.varCode)).size
  const totalRows = entries.filter(e => !e.isEdited).length
  const periods   = new Set(entries.filter(e => !e.isEdited).map(e => e.period)).size
  const subtitle  = `${calcCount} var. calculada${calcCount!==1?"s":""} · ${totalRows} entrada${totalRows!==1?"s":""} · ${periods} período${periods!==1?"s":""}`
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose}/>
      <div className="fixed inset-3 bottom-12 z-50 bg-white rounded-2xl shadow-2xl border border-gray-200
                      flex flex-col overflow-hidden"
           style={{ resize: "both", minHeight: "320px", minWidth: "600px" }}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0"/>
            <span className="font-bold text-gray-900 text-sm">Sequência de cálculo</span>
            <span className="text-xs text-gray-400">{subtitle}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none ml-4">×</button>
        </div>
        {/* Scrollable table */}
        <div className="overflow-auto flex-1">
          <table className="text-xs border-collapse" style={{ minWidth: "100%" }}>
            <thead className="sticky top-0 bg-gray-50 border-b-2 border-gray-200 z-10">
              <tr>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">#</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Variável</th>
                <th className="px-3 py-2.5 text-left font-semibold text-indigo-500 uppercase tracking-wide whitespace-nowrap">Fórmula (ids)</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Contexto</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Período</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Anterior</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Novo</th>
                <th className="px-3 py-2.5 text-left font-semibold text-emerald-600 uppercase tracking-wide whitespace-nowrap">Fórmula (valores)</th>
                <th className="px-3 py-2.5 text-left font-semibold text-violet-500 uppercase tracking-wide whitespace-nowrap">Fórmula (nomes)</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className={`border-b ${
                  e.isEdited ? "bg-sky-50 border-sky-200"
                  : i % 2 === 0 ? "border-gray-100" : "bg-gray-50/40 border-gray-100"
                }`}>
                  {/* # */}
                  <td className="px-3 py-2 text-center text-gray-300 font-mono text-[10px]">
                    {e.isEdited ? <span className="text-sky-500 font-bold">✎</span> : i}
                  </td>
                  {/* Variável */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className={`font-semibold ${e.isEdited ? "text-sky-900" : "text-gray-800"}`}>{e.varName}</div>
                    <div className="font-mono text-gray-400 text-[10px]">{e.varCode}</div>
                  </td>
                  {/* Fórmula ids */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {e.formula
                      ? <code className="font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{e.formula}</code>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Contexto */}
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{e.context || "—"}</td>
                  {/* Período */}
                  <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap">{fmtP(e.period)}</td>
                  {/* Anterior */}
                  <td className="px-3 py-2 text-right font-mono text-gray-400 whitespace-nowrap">{fmt(e.before)}</td>
                  {/* Novo */}
                  <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${e.isEdited ? "text-sky-700" : "text-orange-700"}`}>
                    {fmt(e.after)}
                  </td>
                  {/* Fórmula valores */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {e.formulaValues
                      ? <code className="font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{e.formulaValues}</code>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Fórmula nomes */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {e.formulaNames
                      ? <code className="font-mono text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">{e.formulaNames}</code>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}



/* ═══════════════════════════════════════════════════════════════
   NOVA VERSÃO MODAL
   ═══════════════════════════════════════════════════════════════ */
function NewVersionModal({ versionTypes, name, setName, typeId, setTypeId, onConfirm, onCancel }) {
  const canConfirm = name.trim().length > 0 && typeId != null
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onCancel}/>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                      bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm p-6">
        <h2 className="text-base font-bold text-gray-900 mb-5">Nova versão</h2>
        <div className="flex flex-col gap-4">
          {/* Nome */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Nome
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && canConfirm && onConfirm()}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm
                         focus:outline-none focus:border-sky-400"
              placeholder="Nome da versão"/>
          </div>
          {/* Tipo */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Tipo <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <select
                value={typeId ?? ""}
                onChange={e => setTypeId(parseInt(e.target.value) || null)}
                className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-xl text-sm
                           focus:outline-none focus:border-sky-400 appearance-none bg-white">
                <option value="">— seleciona —</option>
                {versionTypes.map(t => (
                  <option key={t.versionTypeId} value={t.versionTypeId}>
                    {t.name}{t.isLocked ? " 🔒" : ""}
                  </option>
                ))}
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                   viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
              </svg>
            </div>
            {typeId && versionTypes.find(t=>t.versionTypeId===typeId)?.isLocked && (
              <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                🔒 Este tipo bloqueia edição de células
              </p>
            )}
          </div>
        </div>
        {/* Buttons */}
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={!canConfirm}
            className={`flex-1 px-4 py-2 rounded-xl text-sm font-semibold transition-colors
              ${canConfirm ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
            Criar versão
          </button>
        </div>
      </div>
    </>
  )
}



/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL — CRUD independente de 4 tabelas
   Não depende do estado da app principal (projecto activo, etc.)
   ═══════════════════════════════════════════════════════════════ */

// ── Generic helpers ──────────────────────────────────────────
function AdminField({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function AdminInput({ value, onChange, placeholder, mono, type="text", ...rest }) {
  return (
    <input type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white
                  focus:outline-none focus:border-sky-400 transition-colors
                  ${mono ? 'font-mono' : ''}`}
      {...rest}/>
  )
}

function AdminSelect({ value, onChange, children }) {
  return (
    <div className="relative">
      <select value={value ?? ''} onChange={e=>onChange(e.target.value)}
        className="w-full pl-3 pr-8 py-2 border border-gray-200 rounded-xl text-sm bg-white
                   focus:outline-none focus:border-sky-400 appearance-none transition-colors">
        {children}
      </select>
      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
           viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/>
      </svg>
    </div>
  )
}

function AdminTable({ cols, rows, onEdit, onDelete }) {
  if (!rows.length) return (
    <p className="text-sm text-gray-400 text-center py-10">Sem registos.</p>
  )
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-100">
          {cols.map(c => (
            <th key={c.key} className="pb-2 pr-4 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {c.label}
            </th>
          ))}
          <th className="pb-2 w-24"/>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 group transition-colors">
            {cols.map(c => (
              <td key={c.key} className="py-2.5 pr-4">
                {c.render ? c.render(row) : <span className={c.mono ? 'font-mono text-xs text-gray-500' : 'text-gray-800'}>{row[c.key]}</span>}
              </td>
            ))}
            <td className="py-2.5">
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => onEdit(row)}
                  className="text-xs text-sky-600 hover:text-sky-800 font-medium">Editar</button>
                <button onClick={() => onDelete(row)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium">Eliminar</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AdminDeleteModal({ label, onConfirm, onCancel }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-[70]" onClick={onCancel}/>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[70]
                      bg-white rounded-2xl shadow-2xl border border-gray-100 w-80 p-6 text-center">
        <p className="font-semibold text-gray-800 mb-1">Eliminar registo?</p>
        <p className="text-sm text-gray-500 mb-5 truncate">{label}</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold">
            Eliminar
          </button>
        </div>
      </div>
    </>
  )
}

// ── Tab: Tipos de Versão ─────────────────────────────────────
function VersionTypesTab() {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [editing, setEditing] = useState(null)   // null | {} | item
  const [deleting,setDeleting]= useState(null)
  const [saving,  setSaving]  = useState(false)
  const blank = { code:'', name:'', isLocked: false, sortOrder: 1 }

  useEffect(() => {
    api.get('/admin/version-types')
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const openNew  = () => setEditing({ ...blank, sortOrder: items.length + 1 })
  const openEdit = item => setEditing({ ...item })

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim()) return
    setSaving(true)
    try {
      if (editing.versionTypeId) {
        const u = await api.put(`/admin/version-types/${editing.versionTypeId}`, editing)
        setItems(p => p.map(x => x.versionTypeId === u.versionTypeId ? u : x))
      } else {
        const c = await api.post('/admin/version-types', editing)
        setItems(p => [...p, c])
      }
      setEditing(null)
    } catch(e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const confirmDelete = async () => {
    try {
      await api.delete(`/admin/version-types/${deleting.versionTypeId}`)
      setItems(p => p.filter(x => x.versionTypeId !== deleting.versionTypeId))
    } catch(e) { alert(e.message) }
    finally { setDeleting(null) }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">A carregar...</p>
  if (error)   return <p className="text-sm text-red-500 text-center py-10">{error}</p>

  const cols = [
    { key:'code',      label:'Código',   mono:true },
    { key:'name',      label:'Nome' },
    { key:'sortOrder', label:'Ordem',    render: r => <span className="text-gray-400 text-xs">{r.sortOrder}</span> },
    { key:'isLocked',  label:'Bloqueado',render: r => r.isLocked
        ? <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg">🔒 Sim</span>
        : <span className="text-xs text-gray-300">—</span> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={openNew}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors">
          + Novo tipo
        </button>
      </div>
      <AdminTable cols={cols} rows={items} onEdit={openEdit} onDelete={setDeleting}/>
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setEditing(null)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-5 text-sm">
              {editing.versionTypeId ? 'Editar tipo' : 'Novo tipo'}
            </h3>
            <div className="flex flex-col gap-4">
              <AdminField label="Código" required>
                <AdminInput value={editing.code} onChange={v=>setEditing(p=>({...p,code:v}))} placeholder="ex: budget" mono/>
              </AdminField>
              <AdminField label="Nome" required>
                <AdminInput value={editing.name} onChange={v=>setEditing(p=>({...p,name:v}))} placeholder="ex: Budget"
                  onKeyDown={e=>e.key==='Enter'&&save()}/>
              </AdminField>
              <AdminField label="Ordem">
                <AdminInput type="number" value={editing.sortOrder}
                  onChange={v=>setEditing(p=>({...p,sortOrder:parseInt(v)||0}))}/>
              </AdminField>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={editing.isLocked||false}
                  onChange={e=>setEditing(p=>({...p,isLocked:e.target.checked}))}
                  className="w-4 h-4 accent-amber-500"/>
                <span className="text-sm text-gray-700">Bloquear edição de células</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditing(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={save} disabled={!editing.code.trim()||!editing.name.trim()||saving}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      )}
      {deleting && <AdminDeleteModal label={deleting.name} onConfirm={confirmDelete} onCancel={()=>setDeleting(null)}/>}
    </div>
  )
}

// ── Tab: Grupos de Variáveis ─────────────────────────────────
function VariableGroupsTab() {
  const [items,     setItems]     = useState([])
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [editing,   setEditing]   = useState(null)
  const [deleting,  setDeleting]  = useState(null)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    Promise.all([api.get('/admin/groups'), api.get('/admin/templates')])
      .then(([grps, tpls]) => { setItems(grps); setTemplates(tpls) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const openNew  = () => setEditing({ code:'', name:'', sortOrder: items.length+1, templateId: templates[0]?.templateId ?? null })
  const openEdit = item => setEditing({ ...item })

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim() || !editing.templateId) return
    setSaving(true)
    try {
      if (editing.groupId) {
        await api.put(`/admin/groups/${editing.groupId}`, editing)
      } else {
        await api.post('/admin/groups', editing)
      }
      const grps = await api.get('/admin/groups')
      setItems(grps)
      setEditing(null)
    } catch(e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const confirmDelete = async () => {
    try {
      await api.delete(`/admin/groups/${deleting.groupId}`)
      setItems(p => p.filter(x => x.groupId !== deleting.groupId))
    } catch(e) { alert(e.message) }
    finally { setDeleting(null) }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">A carregar...</p>
  if (error)   return <p className="text-sm text-red-500 text-center py-10">{error}</p>

  const cols = [
    { key:'templateName', label:'Template' },
    { key:'code',         label:'Código',    mono:true },
    { key:'name',         label:'Nome' },
    { key:'sortOrder',    label:'Ordem',     render: r => <span className="text-gray-400 text-xs">{r.sortOrder}</span> },
    { key:'variableCount',label:'Variáveis', render: r => <span className="text-gray-400 text-xs">{r.variableCount}</span> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={openNew}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors">
          + Novo grupo
        </button>
      </div>
      <AdminTable cols={cols} rows={items} onEdit={openEdit} onDelete={setDeleting}/>
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setEditing(null)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-5 text-sm">
              {editing.groupId ? 'Editar grupo' : 'Novo grupo'}
            </h3>
            <div className="flex flex-col gap-4">
              <AdminField label="Template" required>
                <AdminSelect value={editing.templateId}
                  onChange={v=>setEditing(p=>({...p,templateId:parseInt(v)||null}))}>
                  <option value="">— seleciona —</option>
                  {templates.map(t=>(
                    <option key={t.templateId} value={t.templateId}>{t.name}</option>
                  ))}
                </AdminSelect>
              </AdminField>
              <AdminField label="Código" required>
                <AdminInput value={editing.code} onChange={v=>setEditing(p=>({...p,code:v}))} placeholder="ex: grp_rec" mono/>
              </AdminField>
              <AdminField label="Nome" required>
                <AdminInput value={editing.name} onChange={v=>setEditing(p=>({...p,name:v}))} placeholder="ex: Receitas"
                  onKeyDown={e=>e.key==='Enter'&&save()}/>
              </AdminField>
              <AdminField label="Ordem">
                <AdminInput type="number" value={editing.sortOrder}
                  onChange={v=>setEditing(p=>({...p,sortOrder:parseInt(v)||0}))}/>
              </AdminField>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditing(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={save}
                disabled={!editing.code.trim()||!editing.name.trim()||!editing.templateId||saving}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      )}
      {deleting && <AdminDeleteModal label={deleting.name} onConfirm={confirmDelete} onCancel={()=>setDeleting(null)}/>}
    </div>
  )
}

// ── Tab: Templates ───────────────────────────────────────────
function TemplatesTab() {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting,setDeleting]= useState(null)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    api.get('/admin/templates')
      .then(setItems)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const openNew  = () => setEditing({ code:'', name:'', description:'' })
  const openEdit = item => setEditing({ ...item })

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim()) return
    setSaving(true)
    try {
      if (editing.templateId) {
        const u = await api.put(`/admin/templates/${editing.templateId}`, editing)
        setItems(p => p.map(x => x.templateId === u.templateId ? u : x))
      } else {
        const c = await api.post('/admin/templates', editing)
        setItems(p => [...p, c])
      }
      setEditing(null)
    } catch(e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const confirmDelete = async () => {
    try {
      await api.delete(`/admin/templates/${deleting.templateId}`)
      setItems(p => p.filter(x => x.templateId !== deleting.templateId))
    } catch(e) { alert(e.message) }
    finally { setDeleting(null) }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">A carregar...</p>
  if (error)   return <p className="text-sm text-red-500 text-center py-10">{error}</p>

  const cols = [
    { key:'code',        label:'Código',     mono:true },
    { key:'name',        label:'Nome' },
    { key:'description', label:'Descrição',  render: r => <span className="text-gray-400 text-xs truncate max-w-xs block">{r.description||'—'}</span> },
    { key:'updatedAt',   label:'Actualizado',render: r => <span className="text-gray-400 text-xs">{new Date(r.updatedAt).toLocaleDateString('pt-PT')}</span> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={openNew}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors">
          + Novo template
        </button>
      </div>
      <AdminTable cols={cols} rows={items} onEdit={openEdit} onDelete={setDeleting}/>
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setEditing(null)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-5 text-sm">
              {editing.templateId ? 'Editar template' : 'Novo template'}
            </h3>
            <div className="flex flex-col gap-4">
              <AdminField label="Código" required>
                <AdminInput value={editing.code} onChange={v=>setEditing(p=>({...p,code:v}))} placeholder="ex: tpl_base" mono/>
              </AdminField>
              <AdminField label="Nome" required>
                <AdminInput value={editing.name} onChange={v=>setEditing(p=>({...p,name:v}))} placeholder="ex: Plano Base"/>
              </AdminField>
              <AdminField label="Descrição">
                <textarea value={editing.description||''}
                  onChange={e=>setEditing(p=>({...p,description:e.target.value}))}
                  rows={3} placeholder="Descrição opcional..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white
                             focus:outline-none focus:border-sky-400 transition-colors resize-none"/>
              </AdminField>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditing(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={save} disabled={!editing.code.trim()||!editing.name.trim()||saving}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      )}
      {deleting && <AdminDeleteModal label={deleting.name} onConfirm={confirmDelete} onCancel={()=>setDeleting(null)}/>}
    </div>
  )
}

// ── Tab: Projectos ───────────────────────────────────────────
function ProjectsTab() {
  const [items,     setItems]     = useState([])
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [editing,   setEditing]   = useState(null)
  const [deleting,  setDeleting]  = useState(null)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    Promise.all([api.get('/admin/projects'), api.get('/admin/templates')])
      .then(([projs, tpls]) => { setItems(projs); setTemplates(tpls) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const openNew  = () => setEditing({ code:'', name:'', templateId: templates[0]?.templateId ?? null })
  const openEdit = item => setEditing({ ...item })

  const save = async () => {
    if (!editing.code.trim() || !editing.name.trim() || !editing.templateId) return
    setSaving(true)
    try {
      if (editing.projectId) {
        const u = await api.put(`/admin/projects/${editing.projectId}`, editing)
        setItems(p => p.map(x => x.projectId === u.projectId ? u : x))
      } else {
        const c = await api.post('/admin/projects', editing)
        setItems(p => [...p, c])
      }
      setEditing(null)
    } catch(e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const confirmDelete = async () => {
    try {
      await api.delete(`/admin/projects/${deleting.projectId}`)
      setItems(p => p.filter(x => x.projectId !== deleting.projectId))
    } catch(e) { alert(e.message) }
    finally { setDeleting(null) }
  }

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">A carregar...</p>
  if (error)   return <p className="text-sm text-red-500 text-center py-10">{error}</p>

  const cols = [
    { key:'code',         label:'Código',   mono:true },
    { key:'name',         label:'Nome' },
    { key:'templateName', label:'Template' },
    { key:'createdAt',    label:'Criado',   render: r => <span className="text-gray-400 text-xs">{new Date(r.createdAt).toLocaleDateString('pt-PT')}</span> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={openNew}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-xl transition-colors">
          + Novo projecto
        </button>
      </div>
      <AdminTable cols={cols} rows={items} onEdit={openEdit} onDelete={setDeleting}/>
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setEditing(null)}/>
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
                          bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-5 text-sm">
              {editing.projectId ? 'Editar projecto' : 'Novo projecto'}
            </h3>
            <div className="flex flex-col gap-4">
              <AdminField label="Código" required>
                <AdminInput value={editing.code} onChange={v=>setEditing(p=>({...p,code:v}))} placeholder="ex: proj_acme" mono
                  disabled={!!editing.projectId}/>
              </AdminField>
              <AdminField label="Nome" required>
                <AdminInput value={editing.name} onChange={v=>setEditing(p=>({...p,name:v}))} placeholder="ex: Acme Corp"/>
              </AdminField>
              <AdminField label="Template" required>
                <AdminSelect value={editing.templateId}
                  onChange={v=>setEditing(p=>({...p,templateId:parseInt(v)||null}))}>
                  <option value="">— seleciona —</option>
                  {templates.map(t=>(
                    <option key={t.templateId} value={t.templateId}>{t.name}</option>
                  ))}
                </AdminSelect>
              </AdminField>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditing(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={save}
                disabled={!editing.code.trim()||!editing.name.trim()||!editing.templateId||saving}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">
                {saving ? 'A guardar...' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      )}
      {deleting && <AdminDeleteModal label={deleting.name} onConfirm={confirmDelete} onCancel={()=>setDeleting(null)}/>}
    </div>
  )
}

// ── AdminPanel shell ─────────────────────────────────────────
function AdminPanel({ onClose }) {
  const [tab, setTab] = useState('types')

  const tabs = [
    { key:'types',  label:'Tipos de Versão' },
    { key:'groups', label:'Grupos de Variáveis' },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose}/>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                      bg-white rounded-2xl shadow-2xl border border-gray-100
                      w-full max-w-3xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-900">Configurações</h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-xl">
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0 px-6 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                ${tab === t.key
                  ? 'border-sky-500 text-sky-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {tab === 'types'  && <VersionTypesTab/>}
          {tab === 'groups' && <VariableGroupsTab/>}
        </div>
      </div>
    </>
  )
}


export default function App(){
  const ctr = useRef(2)

  // ── Loading state ─────────────────────────────────────────
  const [loading,   setLoading]   = useState(true)
  const [apiError,  setApiError]  = useState(null)

  // ── Projectos ─────────────────────────────────────────────
  const [allProjects,      setAllProjects]      = useState([])   // lista completa da API
  const [activeProjectId,  setActiveProjectId]  = useState(null) // integer ID da API

  // ── Templates — each owns its variables + formulas ────────
  const [templates, setTemplates] = useState([])
  const tplCtr = useRef(2)

  // ── Active project ────────────────────────────────────────
  const [project, setProject] = useState({
    id: "c_0", name: "", templateId: "tpl_0", languages: []
  })

  // Derived: template and its vars (what the engine uses)
  const [activeTemplateId, setActiveTemplateId] = useState(null)
  const template = templates.find(t => t.id === (activeTemplateId ?? project?.templateId)) ?? templates[0]
  const vars     = template?.vars ?? []

  // ── Versions, periods, cells ──────────────────────────────
  const [versions, setVersions]     = useState([])
  const [versionTypes, setVersionTypes] = useState([])  // [{versionTypeId, code, name, isLocked}]
  const [activeVerId, setActiveVerId] = useState(null)
  // ── Intervalo de períodos ────────────────────────────────
  const [rangeStart,  setRangeStart]  = useState(202601)
  const [rangeEnd,    setRangeEnd]    = useState(202612)
  const [pageSize,    setPageSize]    = useState(3)
  const [pageOffset,  setPageOffset]  = useState(0)
  const [cells, setCells]           = useState({})
  const [dirtyKeys, setDirtyKeys]   = useState(new Set())

  // ── Carrega dados da API no arranque ──────────────────────
  useEffect(() => {
    // Carrega só a lista de projectos — não auto-selecciona
    // O user escolhe o projecto no dropdown antes de ver os dados
    Promise.all([loadProjectList(), api.get("/version-types")])
      .then(([projects, types]) => {
        setAllProjects(projects)
        setVersionTypes(types)
        setLoading(false)
      })
      .catch(err => {
        console.error("loadProjectList:", err)
        setApiError(err.message)
        setLoading(false)
      })
  }, [])

  // Aplica dados carregados (usado no arranque e na mudança de projecto)
  const applyProjectData = data => {
    setProject(data.project)
    setTemplates([{ id: data.tplId, name: "Template", description: "", vars: data.vars }])
    setVersions(data.versions)
    setActiveVerId(data.activeVerId)
    setCells(data.cells)
    setDirtyKeys(new Set())
    setCompareIds([])
    setCompareMode(false)
    setPanel2VerId(null)
    if (data.periods.length > 0) {
      setRangeStart(data.periods[0])
      setRangeEnd(data.periods[data.periods.length - 1])
    }
    setLoading(false)
  }

  // Muda de projecto — recarrega tudo
  const handleSelectProject = async projId => {
    if (projId === activeProjectId) return
    setActiveTemplateId(null)
    setLoading(true)
    setActiveProjectId(projId)
    try {
      const data = await loadFromApi(projId)
      setAllProjects(data.allProjects)
      applyProjectData(data)
    } catch (err) {
      console.error("handleSelectProject:", err)
      setApiError(err.message)
      setLoading(false)
    }
  }

  // ── UI state ──────────────────────────────────────────────
  const [modal,        setModal]        = useState(null)
  const [showTemplate, setShowTemplate] = useState(false)
  const [showProject,  setShowProject]  = useState(false)
  const [editingProjectId, setEditingProjectId] = useState(null)  // null = list, id = edit specific project
  const [activeTest,   setActiveTest]   = useState(null)
  const [showDict,     setShowDict]     = useState(false)

  // ── Hamburger menu + dual panel ───────────────────────
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [cloning,      setCloning]      = useState(false)
  const [showAdmin,      setShowAdmin]      = useState(false)  // painel de administração
  const [showNewVersion, setShowNewVersion] = useState(false) // modal de nova versão
  const [newVerName,     setNewVerName]     = useState("")
  const [newVerTypeId,   setNewVerTypeId]   = useState(null)

  // ── Delta log — detalhe das variáveis afectadas por interacção ──
  const [deltaLog,     setDeltaLog]     = useState([])
  const [showDeltaLog, setShowDeltaLog] = useState(false)

  // ── Undo stack (máx 5 entradas) ──────────────────────────────
  // Cada entrada: { vid, lid, bid, period, verId, prevValue, label }
  const [undoStack, setUndoStack] = useState([])
  const [dualPanel,    setDualPanel]    = useState(false)
  const [panel2VerId,  setPanel2VerId]  = useState(null)

  // ── Filtros — painel 1 ────────────────────────────────
  const [filterScope1, setFilterScope1] = useState('')   // '' | 'template' | 'language' | 'lob'
  // Filtro de variáveis afectadas — activado automaticamente após cada cálculo
  const [filterAffected1, setFilterAffected1] = useState(false)
  const [filterGroup1,    setFilterGroup1]    = useState('')   // '' | groupId as string
  const [filterType1,  setFilterType1]  = useState('')   // '' | 'input' | 'calculated'
  const [filterLang1,  setFilterLang1]  = useState('')
  const [filterLob1,   setFilterLob1]   = useState('')
  const [filterVar1,   setFilterVar1]   = useState('')

  // ── Filtros — painel 2 ────────────────────────────────
  const [filterScope2, setFilterScope2] = useState('')
  const [filterType2,  setFilterType2]  = useState('')
  const [filterLang2,  setFilterLang2]  = useState('')
  const [filterLob2,   setFilterLob2]   = useState('')
  const [filterVar2,   setFilterVar2]   = useState('')

  // Comparison
  const [compareMode, setCompareMode] = useState(false)
  const [compareIds,  setCompareIds]  = useState([])
  const orderedCV     = compareIds.map(id=>versions.find(v=>v.id===id)).filter(Boolean)
  const showDelta     = orderedCV.length >= 2
  const canCompare    = compareMode && orderedCV.length >= 1
  const colsPerPeriod = orderedCV.length + (showDelta ? 1 : 0)

  const handleToggleVersion = verId =>
    setCompareIds(prev=>prev.includes(verId)?prev.filter(id=>id!==verId):[...prev,verId])
  const handleToggleCompare = () => {
    if (!compareMode && compareIds.length===0){const o=versions.filter(v=>v.id!==activeVerId);setCompareIds(o.length?[activeVerId,o[0].id]:[activeVerId])}
    setCompareMode(p=>!p)
  }

  // ── Lock helpers ──────────────────────────────────────────
  const today = new Date()
  const currentPeriod = today.getFullYear() * 100 + (today.getMonth() + 1)

  // Versão bloqueada por tipo
  const activeVersion   = versions.find(v => v.id === activeVerId)
  const isVersionLocked = activeVersion?.isLocked ?? false

  // Célula bloqueada: versão locked OU período passado
  const isCellLocked = (period) => {
    if (isVersionLocked) return "locked"
    if (period < currentPeriod) return "past"
    return false
  }

  // ── Dirty helpers ─────────────────────────────────────────
  const dirtyVarIds = useMemo(()=>{const ids=new Set();for(const k of dirtyKeys){const p=k.split("·");if(p[3])ids.add(p[3])};return ids},[dirtyKeys])
  const isDirtyCell = (vid,lid,bid,period,verId=activeVerId) => dirtyKeys.has(mk(project.id,verId,period,vid,lid,bid))
  const isVarDirty  = vid => dirtyVarIds.has(vid)

  // ── Test helpers ──────────────────────────────────────────
  const testTargets = useMemo(()=>new Set(activeTest?.targets??[]),[activeTest])
  const isTarget    = vid => testTargets.has(vid)
  const updateOrder = useMemo(()=>activeTest?computeUpdateOrder(vars,activeTest.targets):{},[activeTest,vars])
  const handleSelectTest     = t => {setActiveTest(t);setDirtyKeys(new Set())}
  const handleLaunchFromDict = id => {const t=TESTS.find(x=>x.id===id);if(t){setActiveTest(t);setDirtyKeys(new Set())};setShowDict(false)}

  // ── Template handlers ─────────────────────────────────────
  const handleSaveTemplate = async (newTpl) => {
    // newTpl = { id, name, description } — vars are managed separately via VarModal
    const rawId = parseInt(newTpl.id.replace('tpl_',''))
    try {
      await api.put(`/admin/templates/${rawId}`, { code: newTpl.id, name: newTpl.name, description: newTpl.description })
    } catch(e) { console.error('Save template:', e) }
    setTemplates(prev => prev.map(t => t.id===newTpl.id ? {...t, name:newTpl.name, description:newTpl.description} : t))
    setShowTemplate(false)
  }

  const handleNewTemplate = async () => {
    try {
      const created = await api.post('/admin/templates', { code: `tpl_new_${Date.now()}`, name: "Novo Template", description: "" })
      const newId = `tpl_${created.templateId}`
      setTemplates(prev => [...prev, { id: newId, name: created.name, description: created.description ?? "", vars: [] }])
    } catch(e) {
      // Fallback to in-memory if API fails
      const id = `tpl_${String(tplCtr.current++).padStart(3,"0")}`
      setTemplates(prev => [...prev, { id, name: `Novo Template`, description: "", vars: [] }])
    }
  }

  // Variables live inside the active template
  const handleDeleteTemplate = async (tplId) => {
    const rawId = parseInt(tplId.replace('tpl_',''))
    try { await api.delete(`/admin/templates/${rawId}`) } catch(e) { console.error('Delete template:', e) }
    setTemplates(prev => prev.filter(t => t.id !== tplId))
    setShowTemplate(false)
  }

  const handleSwitchTemplate = (tplId) => {
    // Switch active template — reload vars from it
    const tpl = templates.find(t => t.id === tplId)
    if (tpl) {
      setTemplates(prev => prev.map(t => ({...t})))  // force re-render with new active
      // Navigate to the selected template by making it "active"
      // The TemplateModal re-renders with the new template prop
      const idx = templates.findIndex(t => t.id === tplId)
      if (idx >= 0) setTemplates(prev => {
        const reordered = [...prev]
        // Move selected to front so template = templates[0]... actually just close and reopen
        return prev
      })
    }
  }

  const handleSaveVar = async v => {
    const currentVars = vars
    const exists = currentVars.find(x => x.id === v.id)
    const newVars = exists ? currentVars.map(x=>x.id===v.id?v:x) : [...currentVars, v]
    setTemplates(prev => prev.map(t => t.id===template.id ? {...t, vars:newVars} : t))
    if (project) setCells(c => {let r=c;for(const ver of versions)r=recalcAll(newVars,periods,project,r,ver.id);return r})
    setModal(null)
  }

  const handleDelVar = vid => {
    const newVars = vars.filter(v=>v.id!==vid)
    setTemplates(prev => prev.map(t => t.id===template.id ? {...t, vars:newVars} : t))
    setCells(c => {let r=c;for(const ver of versions)r=recalcAll(newVars,periods,project,r,ver.id);return r})
    setModal(null)
  }

  // ── Project handlers ──────────────────────────────────────
  const handleCreateProject = async () => {
    // Opens ProjectModal with a blank project
    setEditingProjectId('new')
  }

  const handleDeleteProject = async (projectId) => {
    try {
      await api.delete(`/admin/projects/${projectId}`)
      setAllProjects(prev => prev.filter(p => p.projectId !== projectId))
    } catch(e) { alert('Erro ao eliminar projecto: ' + e.message) }
  }

  const handleSaveProject = newProject => {
    const newTemplate = templates.find(t=>t.id===newProject.templateId) ?? template
    const newVars     = newTemplate.vars

    let newCells
    if (newProject.templateId !== project.templateId) {
      // Template changed: rebuild cells from scratch for all versions
      newCells = {}
      for (const ver of versions) newCells = recalcAll(newVars, periods, newProject, newCells, ver.id)
    } else {
      // Same template: filter out cells for removed langs/lobs then recalc
      const validLangIds = new Set(newProject.languages.map(l=>l.id))
      const validLobIds  = new Set(newProject.languages.flatMap(l=>l.lobs.map(b=>b.id)))
      newCells = Object.fromEntries(
        Object.entries(cells).filter(([key])=>{
          const p=key.split("·"); const lid=p[4],bid=p[5]
          if(lid&&!validLangIds.has(lid))return false
          if(bid&&!validLobIds.has(bid)) return false
          return true
        })
      )
      for (const ver of versions) newCells = recalcAll(newVars, periods, newProject, newCells, ver.id)
    }

    // Persist to API (name + templateId only — languages managed separately)
    const rawId = parseInt(newProject.id.replace('c_',''))
    if (rawId) {
      const rawTplId = parseInt(newProject.templateId.replace('tpl_',''))
      api.put(`/admin/projects/${rawId}`, {
        templateId: rawTplId, code: newProject.code ?? '', name: newProject.name
      }).catch(e => console.error('Save project:', e))
    }
    setProject(newProject)
    setAllProjects(prev => prev.map(p => p.projectId === rawId ? {...p, name: newProject.name} : p))
    setCells(newCells)
    setShowProject(false)
  }

  // ── Version handlers ──────────────────────────────────────
  const activeColorIdx = versions.findIndex(v=>v.id===activeVerId)
  const handleSelectVersion = async verId => {
    setActiveVerId(verId)
    setDirtyKeys(new Set())
    // Carrega células se ainda não estiverem em memória para esta versão
    const hasVersionCells = Object.keys(cells).some(k => k.split("·")[1] === String(verId))
    if (!hasVersionCells) {
      try {
        const resp = await api.get(`/versions/${verId}/cells`)
        const mapped = apiCellsToProto(resp.cells, project, vars, verId)
        setCells(prev => ({ ...prev, ...mapped }))
      } catch (e) { console.error("Load version cells:", e) }
    }
  }
  // ── Undo — reverte a última edição ──────────────────────────
  const handleUndo = async () => {
    if (!undoStack.length) return
    const [entry, ...rest] = undoStack
    setUndoStack(rest)
    setFilterAffected1(false)
    await handleCellChange(entry.vid, entry.lid, entry.bid,
                           entry.period, entry.prevValue, entry.verId)
  }

  // Ctrl+Z → undo
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoStack])

  const openNewVersionModal = () => {
    if (!activeVerId) { alert("Nenhuma versão activa seleccionada."); return }
    const idx = versions.length + 1
    setNewVerName(`Versão ${idx}`)
    setNewVerTypeId(versionTypes[0]?.versionTypeId ?? null)
    setShowNewVersion(true)
  }

  const handleAddVersion = async () => {
    if (cloning) return
    const trimmed = (newVerName || "").trim()
    if (!trimmed || !newVerTypeId) return
    setShowNewVersion(false)
    setCloning(true)
    const idx = versions.length + 1
    const ts = Date.now().toString(36).slice(-4)
    try {
      const newVer = await api.post("/versions/clone", {
        fromVersionId: activeVerId,
        code: `v${idx}_${ts}`,
        name: trimmed,
        versionTypeId: newVerTypeId
      })
      const cellsResp = await api.get(`/versions/${newVer.versionId}/cells`)

      const newCells = apiCellsToProto(cellsResp.cells, project, vars, newVer.versionId)
      setVersions(prev => [...prev, { id: newVer.versionId, name: newVer.name, colorIdx: idx % VER_PALETTE.length, typeName: newVer.versionTypeName, isLocked: newVer.isLocked }])
      setCells(prev => ({ ...prev, ...newCells }))
      setActiveVerId(newVer.versionId)
      setDirtyKeys(new Set())
      setUndoStack([])   // nova versão = novo ponto de partida
    } catch (err) {
      console.error("Clone version:", err)
      alert(`Erro ao criar versão: ${err.message}`)
    } finally {
      setCloning(false)
    }
  }
  const handleRenameVersion = (verId,name) => setVersions(prev=>prev.map(v=>v.id===verId?{...v,name}:v))
  const handleDeleteVersion = verId => {
    if(versions.length<=1)return
    const remaining=versions.filter(v=>v.id!==verId)
    setVersions(remaining);setCells(prev=>deleteVersionCells(prev,verId))
    setCompareIds(prev=>prev.filter(id=>id!==verId))
    if(activeVerId===verId){setActiveVerId(remaining[0].id);setDirtyKeys(new Set())}
  }

  // ── Cell change — chama a API, aplica delta ───────────────
  const handleCellChange = async (vid,lid,bid,period,val,verId=activeVerId) => {
    const v = vars.find(x => x.id === vid)
    if (!v) return
    const year = Math.floor(period / 100), month = period % 100
    const key  = mk(project.id, verId, period, vid, lid, bid)
    // Guarda estado anterior no undo stack (máx 5)
    const currentCell = cells[key]
    const prevValue   = currentCell?.value ?? null
    const lang  = project.languages.find(l => l.id === lid)
    const lob   = lang?.lobs.find(b => b.id === bid)
    const ctx   = lang && lob ? `${lang.code} / ${lob.name}` : lang ? lang.code : ''
    const label = `${v.name}${ctx ? ' · ' + ctx : ''} · ${fmtP(period)}: ${prevValue ?? '—'} → ${val ?? '—'}`
    setUndoStack(prev => [{ vid, lid, bid, period, verId, prevValue, label }, ...prev].slice(0, 5))

    // Limpa o log da interacção anterior
    setDeltaLog([])
    setShowDeltaLog(false)
    // Optimistic update imediato
    setCells(prev => ({ ...prev, [key]: { value: val, status: val != null ? "ok" : "empty", source: "manual" } }))
    try {
      const result = await api.patch(`/versions/${verId}/cells`, {
        variableId: v._apiId,
        languageId: fromLangId(lid),
        lobId:      fromLobId(bid),
        year, month,
        value:  val,
        source: "manual"
      })
      // Aplica delta e constrói log — a variável editada aparece primeiro
      const deltaKeys = new Set()

      // Constrói o log FORA do setCells updater para evitar duplicação
      // em React Strict Mode (que chama updaters duas vezes)
      const newLog = [{
        varName:  v.name,
        varCode:  v.id,
        context:  ctx,
        period,
        before:   prevValue,
        after:    val,
        formula:  null,
        isEdited: true
      }]

      // Snapshot do estado actual para capturar "before" de cada célula do delta
      const cellsSnapshot = cells
      const cellUpdates   = {}

      for (const cell of result.delta) {
        const dv = vars.find(x => x._apiId === cell.variableId)
        if (!dv) continue
        const dlid = toLangId(cell.languageId)
        const dbid = toLobId(cell.lobId)
        const dk   = mk(project.id, verId, cell.year * 100 + cell.month, dv.id, dlid, dbid)

        // Captura before do snapshot (não do working dict que pode já ter mudado)
        const beforeVal = cellsSnapshot[dk]?.value ?? null
        cellUpdates[dk] = { value: cell.value, status: cell.status, source: cell.source }
        deltaKeys.add(dk)

        const lang    = project.languages.find(l => l.id === dlid)
        const lob     = lang?.lobs.find(b => b.id === dbid)
        const context = lang && lob ? `${lang.code} / ${lob.name}`
                      : lang        ? lang.code
                      : null
        const activeFormula = cell.formulaId
          ? dv.alternatives?.find(a => a._formulaId === cell.formulaId)?.formula ?? dv.formula
          : dv.formula

        newLog.push({
          varName: dv.name,
          varCode: dv.id,
          context,
          period:  cell.year * 100 + cell.month,
          before:  beforeVal,
          after:   cell.value,
          formula: activeFormula ?? null
        })
      }

      // Estado final após todos os cálculos — usado para resolver valores nas fórmulas
      const finalCells = { ...cellsSnapshot, ...cellUpdates }

      // Enriquece cada entrada com a fórmula substituída por valores e por nomes
      // Helper: formata número sem separador de milhares (mais legível em fórmulas)
      const fmtVal = v => v == null ? null
        : Number.isInteger(v) ? v.toString()
        : Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 4, useGrouping: false })

      const resolveFormula = (formula, entryContext, entryPeriod) => {
        if (!formula) return { withValues: null, withNames: null }

        // Identifica lang/lob do contexto da entrada
        const parts    = (entryContext || '').split(' / ')
        const entryLang = project.languages.find(l => l.code === parts[0])
        const entryLob  = entryLang?.lobs.find(b => b.name === parts[1] || b.code === parts[1])

        // Lookup scope-aware: usa o scope declarado da variável para encontrar a chave certa
        const lookupVal = (code, period) => {
          const dv = vars.find(x => x.id === code)
          if (!dv) return null
          // Determina langId/lobId com base no scope da variável
          let langId = entryLang?.id
          let lobId  = entryLob?.id
          if      (dv.scope === 'project') { langId = undefined; lobId = undefined }
          else if (dv.scope === 'language') { lobId  = undefined }
          // lob scope → usa contexto da entrada (langId + lobId)
          const key = mk(project.id, verId, period, code, langId, lobId)
          return finalCells[key]?.value ?? null
        }

        // Período anterior (para PREV)
        const prevP = (() => {
          const y = Math.floor(entryPeriod/100), m = entryPeriod%100
          return m === 1 ? (y-1)*100+12 : y*100+(m-1)
        })()

        // Substitui PREV(v_xxx) primeiro, antes da substituição genérica
        // ── Passo 1: substitui PREV(v_xxx) ──────────────────────
        const applyPrev = str => str.replace(/PREV\(v_[a-z_0-9]+\)/g, match => {
          const code = match.match(/v_[a-z_0-9]+/)[0]
          const val  = lookupVal(code, prevP)
          return val != null ? `PREV(${fmtVal(val)})` : match
        })

        // ── Passo 2: substitui referências qualificadas v_xxx[lang][lob] ──
        // Deve ser feito ANTES da substituição genérica para evitar que
        // v_rec[PT][ret] se torne 2100[PT][ret]
        const applyQualified = (str, transform) =>
          str.replace(/v_[a-z_0-9]+\[([^\]]+)\](?:\[([^\]]+)\])?/g, (match, langQ, lobQ) => {
            const code    = match.match(/^v_[a-z_0-9]+/)[0]
            const dv      = vars.find(x => x.id === code)
            if (!dv) return match
            // Resolve lang e lob do qualificador
            const qLang   = langQ && langQ !== '*' ? project.languages.find(l => l.code === langQ) : entryLang
            const qLob    = lobQ  && lobQ  !== '*' ? qLang?.lobs.find(b => b.code === lobQ || b.name === lobQ) : entryLob
            return transform(code, qLang, qLob, match)
          })

        // ── Passo 3: substitui variáveis simples (sem qualificador) ───────
        const applySimple = (str, transform) =>
          str.replace(/v_[a-z_0-9]+/g, code => transform(code))

        // Fórmula com valores: qualificadas primeiro, depois simples
        let withValues = applyPrev(formula)
        withValues = applyQualified(withValues, (code, qLang, qLob) => {
          // Lookup com o contexto do qualificador
          let langId = qLang?.id
          let lobId  = qLob?.id
          const dv = vars.find(x => x.id === code)
          if (dv?.scope === 'project')  { langId = undefined; lobId = undefined }
          else if (dv?.scope === 'language') { lobId = undefined }
          const key = mk(project.id, verId, entryPeriod, code, langId, lobId)
          const val = finalCells[key]?.value ?? null
          return val != null ? fmtVal(val) : code
        })
        withValues = applySimple(withValues, code => {
          const val = lookupVal(code, entryPeriod)
          return val != null ? fmtVal(val) : code
        })

        // Fórmula com nomes: qualificadas primeiro (preserva qualificadores), depois simples
        let withNames = applyQualified(formula, (code, qLang, qLob, original) => {
          const dv = vars.find(x => x.id === code)
          if (!dv) return original
          // Reconstrói com o nome mas mantém qualificadores para clareza
          const langPart = qLang ? `[${qLang.code}]` : ''
          const lobPart  = qLob  ? `[${qLob.name}]`  : ''
          return `${dv.name}${langPart}${lobPart}`
        })
        withNames = applySimple(withNames, code => {
          const dv = vars.find(x => x.id === code)
          return dv ? dv.name : code
        })

        return { withValues, withNames }
      }

      // Acrescenta as colunas de fórmula com valores e nomes a cada entrada.
      // Isolado em try/catch próprio — um erro aqui não deve impedir o log de ser mostrado.
      try {
        for (const e of newLog) {
          if (!e.isEdited && e.formula) {
            const { withValues, withNames } = resolveFormula(e.formula, e.context, e.period)
            e.formulaValues = withValues
            e.formulaNames  = withNames
          }
        }
      } catch (fmtErr) {
        console.warn("resolveFormula:", fmtErr)
      }

      // Aplica todas as actualizações de uma vez — sem side effects no updater
      setCells(prev => ({ ...prev, ...cellUpdates }))
      // Mantém a ordem original do motor (ordem de cálculo).
      // Filtra apenas entradas sem alteração real (Anterior = Novo) — são ruído.
      // A variável editada pelo user é sempre mostrada (isEdited).
      const filteredLog = newLog.filter(e =>
        e.isEdited ||
        e.before !== e.after ||
        (e.before == null && e.after != null) ||
        (e.before != null && e.after == null)
      )

      setDeltaLog(filteredLog)
      setDirtyKeys(prev => new Set([...prev, ...deltaKeys]))
      // Activa automaticamente o filtro de afectadas após o cálculo
      if (filteredLog.length > 1) setFilterAffected1(true)
    } catch (err) {
      console.error("EditCell:", err)
      // Reverte optimistic update
      setCells(prev => { const u = {...prev}; delete u[key]; return u })
    }
  }

  // handleAddPeriod removido — usar PeriodRangeSelector no header

  // ── Derived: panel2 version ─────────────────────────────
  const panel2ActiveVerId = panel2VerId ?? activeVerId
  const panel2ColorIdx    = versions.findIndex(v => v.id === panel2ActiveVerId)

  // ── Filter helper ─────────────────────────────────────
  const isInput  = v => !v.formula && !v.alternatives?.length

  const applyFilters = (allRows, fScope, fType, fLang, fLob, fVar, affectedIds, fGroup) => allRows.filter(({v, lid, bid}) => {
    // Filtro de afectadas — tem precedência sobre todos os outros
    if (affectedIds && !affectedIds.has(v.id)) return false
    // Filtro de grupo
    if (fGroup && String(v.groupId) !== fGroup) return false
    // Filtro por âmbito (scope)
    if (fScope && v.scope !== fScope) return false
    // Filtro por tipo (input vs calculada)
    if (fType === 'input'      &&  (v.formula || v.alternatives?.length)) return false
    if (fType === 'calculated' && !(v.formula || v.alternatives?.length)) return false
    // Filtro por variável (nome ou código)
    if (fVar) {
      const q = fVar.toLowerCase()
      if (!v.name.toLowerCase().includes(q) && !v.id.toLowerCase().includes(q)) return false
    }
    // Filtro por língua
    if (fLang && lid) {
      const lang = project.languages.find(l => l.id === lid)
      if (lang?.code !== fLang) return false
    }
    // Filtro por LOB
    if (fLob && bid) {
      const lang = project.languages.find(l => l.id === lid)
      const lob  = lang?.lobs.find(b => b.id === bid)
      if (lob?.code !== fLob) return false
    }
    return true
  })

  // ── Grid rows ─────────────────────────────────────────────
  // ── Períodos derivados do intervalo seleccionado ──────────
  const allPeriods     = generatePeriods(rangeStart, rangeEnd)
  const visiblePeriods = allPeriods.slice(pageOffset * pageSize, (pageOffset + 1) * pageSize)
  // Retrocompatibilidade: code que usa "periods" lê visiblePeriods
  const periods = visiblePeriods

  // Ordena por âmbito: template → language → lob
  const SCOPE_PRIO = { project: 0, language: 1, lob: 2 }
  const sortedVars = [...vars].sort((a, b) => SCOPE_PRIO[a.scope] - SCOPE_PRIO[b.scope])
  const rows = sortedVars.flatMap(v=>{
    if(v.scope==="project")return[{v,lid:undefined,bid:undefined,ctx:"—"}]
    if(v.scope==="language")return project.languages.map(l=>({v,lid:l.id,bid:undefined,ctx:`${l.code} — ${l.name}`}))
    return project.languages.flatMap(l=>l.lobs.map(b=>({v,lid:l.id,bid:b.id,ctx:`${l.code} / ${b.name}`})))
  })

  const getActiveFm = (v,lid,bid,period,verId=activeVerId) => {
    if(!v.alternatives?.length)return v.formula
    const k=mk(project.id,verId,period,v.id,lid,bid);const act=cells[k]?.activeTriggerId
    const alt=v.alternatives.find(a=>a.trigger===act);return alt?.formula??v.defaultFormula??null
  }

  const dirtyByScope = useMemo(()=>{
    const g={lob:[],language:[],project:[]}
    for(const vid of dirtyVarIds){const v=vars.find(x=>x.id===vid);if(v&&!g[v.scope].includes(vid))g[v.scope].push(vid)}
    return g
  },[dirtyVarIds,vars])

  const hasDirty   = dirtyKeys.size > 0
  const activeCol  = verColor(activeColorIdx)
  const deltaLabel = orderedCV.length===2?`Δ ${orderedCV[1].name} − ${orderedCV[0].name}`:orderedCV.length>2?`Δ ${orderedCV[orderedCV.length-1].name} − ${orderedCV[0].name}`:"Δ"

  // Grupos disponíveis — derivados das variáveis carregadas (hook antes dos early returns)
  const availableGroups = useMemo(() => {
    const seen = new Map()
    vars.forEach(v => {
      if (v.groupId && !seen.has(v.groupId))
        seen.set(v.groupId, v.groupName ?? `Grupo ${v.groupId}`)
    })
    return Array.from(seen.entries()).map(([id, name]) => ({ id: String(id), name }))
  }, [vars])

  // ── Loading / error screen ───────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
        <p className="text-sm text-gray-500">A carregar dados...</p>
      </div>
    </div>
  )
  if (apiError) return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center max-w-sm p-6 bg-white rounded-2xl shadow border border-red-100">
        <p className="text-sm font-bold text-red-600 mb-2">Erro ao ligar à API</p>
        <p className="text-xs text-gray-500">{apiError}</p>
        <p className="text-xs text-gray-400 mt-3">Confirma que a API está a correr em localhost:5000</p>
      </div>
    </div>
  )

  // ── Computed filtered rows ──────────────────────────────
  const affectedVarIds1 = filterAffected1 && deltaLog.length
    ? new Set(deltaLog.map(e => e.varCode))
    : null
  const rows1 = applyFilters(rows, filterScope1, filterType1, filterLang1, filterLob1, filterVar1, affectedVarIds1, filterGroup1)
  const rows2 = applyFilters(rows, filterScope2, filterType2, filterLang2, filterLob2, filterVar2, null, null)

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Hamburger Sidebar ── */}
      <HamburgerMenu open={menuOpen} onClose={()=>setMenuOpen(false)}
        onTemplate={()=>setShowTemplate(true)}
        onProject={()=>{ setShowProject(true); setEditingProjectId(null) }}
        onDict={()=>setShowDict(true)}
        onAdmin={()=>setShowAdmin(true)}/>

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm flex-wrap">

        {/* Hamburger button */}
        <button onClick={()=>setMenuOpen(true)}
          className="flex flex-col gap-1 p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0 group" title="Menu">
          <span className="w-5 h-0.5 bg-gray-600 rounded group-hover:bg-gray-900 transition-colors"/>
          <span className="w-5 h-0.5 bg-gray-600 rounded group-hover:bg-gray-900 transition-colors"/>
          <span className="w-5 h-0.5 bg-gray-600 rounded group-hover:bg-gray-900 transition-colors"/>
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">∑</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-sm font-bold text-gray-900 leading-none">Motor de Cálculo</h1>
            <p className="text-xs text-gray-400">Gestão de Versões</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Teste</label>
          <div className="relative">
            <select value={activeTest?.id??""} onChange={e=>handleSelectTest(TESTS.find(t=>t.id===e.target.value)??null)}
              className="pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-xl bg-white outline-none focus:border-sky-400 appearance-none cursor-pointer min-w-52">
              <option value="">— seleciona —</option>
              {TESTS.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
          </div>
        </div>

        {activeTest&&<div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 max-w-xs shrink-0"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse"/><span className="truncate">{activeTest.desc}</span><button onClick={()=>handleSelectTest(null)} className="text-green-500 hover:text-green-700 font-bold ml-1 shrink-0">×</button></div>}
        {hasDirty&&<div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-xl shrink-0"><span className="w-2 h-2 rounded-full bg-orange-400"/><span className="text-xs text-orange-700 font-medium">{dirtyVarIds.size} var. modificada{dirtyVarIds.size!==1?"s":""}</span><button onClick={()=>setDirtyKeys(new Set())} className="text-orange-500 hover:text-orange-700 text-xs font-bold ml-1">×</button></div>}

        <div className="flex-1"/>
        {/* ── Selector de projecto ── */}
        <div className="flex items-center gap-2 border-r border-gray-200 pr-4 shrink-0">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">Projecto</label>
          <div className="relative">
            <select
              value={activeProjectId ?? ''}
              onChange={e => e.target.value && handleSelectProject(parseInt(e.target.value))}
              className={`pl-3 pr-8 py-1.5 text-sm border rounded-xl bg-white outline-none focus:border-sky-400 appearance-none cursor-pointer min-w-44
                ${!activeProjectId ? "border-orange-300 text-orange-500 font-semibold" : "border-gray-300 text-gray-800"}`}>
              <option value="">— seleciona —</option>
              {allProjects.map(p => (
                <option key={p.projectId} value={p.projectId}>{p.name}</option>
              ))}
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
          </div>
        </div>

        {/* ── Admin button ── */}
        <button onClick={()=>setShowAdmin(true)} title="Configurações"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
          </svg>
        </button>

        {/* ── Âmbito legend ── */}
        <div className="flex items-center gap-2 border-r border-gray-200 pr-4 shrink-0">
          {Object.entries(SC).map(([k,v])=>(<span key={k} className={`text-xs px-2.5 py-1 rounded-full font-medium ${v.badge}`}>{v.label}</span>))}
        </div>

        {/* Selector de intervalo de períodos */}
        <PeriodRangeSelector
          rangeStart={rangeStart} rangeEnd={rangeEnd}
          setRangeStart={setRangeStart} setRangeEnd={setRangeEnd}
          pageSize={pageSize} setPageSize={setPageSize}
          pageOffset={pageOffset} setPageOffset={setPageOffset}
          allPeriods={allPeriods} visiblePeriods={visiblePeriods}/>

        {/* Dual panel toggle */}
        <button onClick={()=>setDualPanel(p=>!p)}
          title={dualPanel ? "Painel único" : "Duplo painel"}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all shrink-0
            ${dualPanel?"bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700":"bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"/>
          </svg>
          {dualPanel ? "Painel único" : "Duplo painel"}
        </button>
      </header>

      {/* ── Main panels ── */}
      <div className="flex-1 overflow-hidden flex">

      {/* ════ Panel 1 ════ */}
      <div className={`flex flex-col overflow-hidden ${dualPanel?"w-1/2 border-r-2 border-gray-300":"flex-1"}`}>

        {/* Placeholder: só aparece quando não há projecto seleccionado */}
        {/* ── Placeholder quando não há projecto seleccionado ── */}
      {!activeProjectId && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-300">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-600 text-base">Selecciona um projecto</p>
            <p className="text-sm text-gray-400 mt-1">Escolhe um projecto no dropdown acima para ver os dados</p>
          </div>
        </div>
      )}

        {/* Conteúdo do painel: só aparece com projecto seleccionado */}
        {activeProjectId && (
          <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Version bar ── */}
            <div className="bg-white border-b border-gray-200 px-5 flex items-center overflow-x-auto shrink-0">
              {versions.map((ver,idx)=>(
                <VersionTab key={ver.id} ver={ver} colorIdx={ver.colorIdx??idx} isActive={ver.id===activeVerId}
                  onSelect={handleSelectVersion} onClone={handleAddVersion}
                  onRename={name=>handleRenameVersion(ver.id,name)}
                  onDelete={()=>handleDeleteVersion(ver.id)} canDelete={versions.length>1}/>
              ))}
              <button onClick={openNewVersionModal} disabled={cloning}
                className="flex items-center gap-1.5 px-3 py-2.5 text-gray-400 hover:text-gray-600 text-xs font-medium transition-colors whitespace-nowrap border-b-2 border-transparent hover:border-gray-200 ml-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {cloning ? <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin inline-block"/> : null}
                {cloning ? "A criar..." : "+ Nova versão"}
              </button>
              <div className="flex-1"/>
              <button onClick={handleToggleCompare}
                className={`flex items-center gap-1.5 px-3.5 py-2 mx-2 text-xs font-semibold rounded-xl border transition-all shrink-0
                  ${compareMode?"bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700":"bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
                <span>⇄</span> Comparar versões
              </button>
            </div>

            {/* ── Comparison toolbar ── */}
            {activeProjectId && compareMode&&(
              <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-2.5 flex items-center gap-4 shrink-0">
                <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wide shrink-0">Versões</span>
                <VersionMultiSelect versions={versions} selectedIds={compareIds} onToggle={handleToggleVersion} onClear={()=>setCompareIds([])}/>
                {orderedCV.length>=1&&(
                  <div className="flex items-center gap-1.5 text-xs text-indigo-600 bg-white px-3 py-1.5 rounded-lg border border-indigo-200">
                    {orderedCV.map((ver,i)=>{const col=verColor(ver.colorIdx??versions.findIndex(v=>v.id===ver.id));return(<span key={ver.id} className="flex items-center gap-1">{i>0&&<span className="text-indigo-200 mx-0.5">·</span>}<span className={`w-2 h-2 rounded-full ${col.dot}`}/><span className="font-medium">{ver.name}</span></span>)})}
                    {showDelta&&<span className="flex items-center gap-1 ml-1 pl-2 border-l border-indigo-200"><span className="text-indigo-400 font-mono font-bold">Δ</span><span className="text-indigo-400">{orderedCV[orderedCV.length-1].name} − {orderedCV[0].name}</span></span>}
                  </div>
                )}
                {orderedCV.length===0&&<span className="text-xs text-indigo-400 italic">Selecciona pelo menos uma versão</span>}
                <div className="flex-1"/>
                <button onClick={()=>setCompareMode(false)} className="text-indigo-400 hover:text-indigo-600 text-xs font-semibold shrink-0">Fechar ×</button>
              </div>
            )}

            {/* ── Filtros Painel 1 ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <GridFilters project={project}
                filterScope={filterScope1} setFilterScope={setFilterScope1}
                filterType={filterType1}   setFilterType={setFilterType1}
                filterLang={filterLang1}   setFilterLang={setFilterLang1}
                filterLob={filterLob1}     setFilterLob={setFilterLob1}
                filterVar={filterVar1}     setFilterVar={setFilterVar1}
                filterGroup={filterGroup1} setFilterGroup={setFilterGroup1}
                availableGroups={availableGroups}/>
              {/* Pill de variáveis afectadas */}
              {deltaLog.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {!filterAffected1 ? (
                    <button onClick={()=>setFilterAffected1(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold
                                 bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                      <span className="w-2 h-2 rounded-full bg-white/80"/>
                      {new Set(deltaLog.map(e=>e.varCode)).size} afectadas
                      <span className="ml-0.5 px-1.5 py-0.5 bg-white/20 rounded-md">Ver só estas</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold
                                    bg-orange-500 text-white border border-orange-500">
                      <span className="w-2 h-2 rounded-full bg-white/80"/>
                      {new Set(deltaLog.map(e=>e.varCode)).size} afectadas
                      <button onClick={()=>setFilterAffected1(false)}
                        className="ml-1 hover:text-orange-200 font-bold">×</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Grid Painel 1 ── */}
            <div className="flex-1 overflow-auto">
              <table className="border-collapse text-sm w-full">
                <thead>
                  {!canCompare&&(
                    <tr className="bg-white border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
                      <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-52">Variável</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-24">Âmbito</th>
                      <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-32 border-r border-gray-200">Contexto</th>
                      {periods.map(p=>(<th key={p} className="px-3 py-3 text-center font-semibold text-gray-600 text-xs uppercase tracking-wide min-w-32 border-l border-gray-100">{fmtP(p)}</th>))}
                    </tr>
                  )}
                  {canCompare&&(<>
                    <tr className="bg-white border-b border-gray-100 sticky top-0 z-10">
                      <th rowSpan={2} className="text-left px-4 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide w-52 border-b-2 border-gray-200 align-bottom bg-white">Variável</th>
                      <th rowSpan={2} className="text-left px-3 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide w-24 border-b-2 border-gray-200 align-bottom bg-white">Âmbito</th>
                      <th rowSpan={2} className="text-left px-3 py-2.5 font-semibold text-gray-500 text-xs uppercase tracking-wide w-32 border-r border-gray-200 border-b-2 align-bottom bg-white">Contexto</th>
                      {periods.map(p=>(<th key={p} colSpan={colsPerPeriod} className="px-2 py-2 text-center font-bold text-gray-700 text-xs uppercase tracking-wide border-l-2 border-gray-300 bg-gray-50">{fmtP(p)}</th>))}
                    </tr>
                    <tr className="bg-white border-b-2 border-gray-200 sticky top-[37px] z-10 shadow-sm">
                      {periods.flatMap(p=>orderedCV.map((ver,vi)=>{const col=verColor(ver.colorIdx??versions.findIndex(v=>v.id===ver.id));return(<th key={`${p}-${ver.id}`} className={`px-2 py-1.5 text-center min-w-24 ${vi===0?"border-l-2 border-gray-300":"border-l border-gray-100"}`}><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${col.active}`}><span className={`w-1.5 h-1.5 rounded-full ${col.dot}`}/>{ver.name}</span></th>)}).concat(showDelta?[<th key={`${p}-d`} className="px-2 py-1.5 text-center min-w-20 border-l border-indigo-200 bg-indigo-50/60 text-xs font-bold text-indigo-400">Δ</th>]:[]))}
                    </tr>
                  </>)}
                </thead>
                <tbody>
                  {rows1.map((row,idx)=>{
                    const{v,lid,bid,ctx}=row
                    const prev=rows1[idx-1];const isFirst=!prev||prev.v.id!==v.id
                    const next=rows1[idx+1];const isLast=!next||next.v.id!==v.id
                    // Group header — only when group changes and variable has a group
                    const prevGroupId=prev?.v?.groupId
                    const showGroupHeader=isFirst&&v.groupId&&v.groupId!==prevGroupId
                    const sc=SC[v.scope];const inp=isInput(v)
                    const varDirty=isVarDirty(v.id);const varTarget=isTarget(v.id)
                    const seqNum=updateOrder[v.id];const rowBg=varTarget?"bg-green-50/60":inp?"bg-cyan-50/40":sc.bg
                    const borderCls=isFirst&&isLast?"border-t-2 border-t-gray-300 border-b-2 border-b-gray-300"
                                   :isFirst?"border-t-2 border-t-gray-300 border-b border-b-gray-100"
                                   :isLast?"border-b-2 border-b-gray-300 border-t-0"
                                   :"border-b border-b-gray-100"
                    const groupHeaderRow = showGroupHeader ? (
                      <tr key={`grp-${v.groupId}`} className="bg-gray-50 border-t-2 border-gray-200">
                        <td colSpan={999} className="px-4 py-1.5">
                          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                            {v.groupName}
                          </span>
                        </td>
                      </tr>
                    ) : null
                    return(<>
                      {groupHeaderRow}
                      <tr key={`row-${v.id}-${lid}-${bid}`} className={`transition-colors ${rowBg} ${borderCls}`}>
                        <td className="px-4 py-2 align-top">
                          {isFirst&&(<div className="relative pr-5">
                            <OrderBadge n={seqNum}/>
                            <div className="flex items-center gap-1.5 group">
                              <span className={`font-semibold text-sm transition-colors ${varDirty?"text-orange-700":varTarget?"text-green-700":"text-gray-800"}`}>{v.name}</span>
                              {varTarget&&!varDirty&&<span className="text-green-500 text-xs animate-pulse">●</span>}
                              {varDirty&&<span className="text-orange-400 text-xs">●</span>}
                              <button onClick={()=>setModal(v)} className="text-gray-300 hover:text-sky-500 opacity-0 group-hover:opacity-100 text-xs transition-all">✎</button>
                            </div>
                            <div className={`text-xs font-mono mt-0.5 ${varDirty?"text-orange-500":varTarget?"text-green-600":"text-gray-400"}`}>{v.id}</div>
                            {!inp&&!v.alternatives?.length&&v.formula&&<div className="text-xs text-gray-400 font-mono mt-0.5 max-w-44 truncate" title={v.formula}>{v.formula}</div>}
                            {!inp&&v.alternatives?.length>0&&<div className="text-xs text-violet-500 mt-0.5 font-medium">{v.alternatives.length} alternativa{v.alternatives.length>1?"s":""}</div>}
                            {varTarget&&inp&&<div className="text-xs text-green-600 font-semibold mt-0.5">← edita este valor</div>}
                          </div>)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {isFirst&&<div className="flex flex-col gap-1"><Badge scope={v.scope}/>{inp&&<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-semibold w-fit">✎ input</span>}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200 align-middle">{ctx}</td>
                        {!canCompare&&periods.map(period=>{
                          const key=mk(project.id,activeVerId,period,v.id,lid,bid);const cs=cells[key]

                          const val=cs?.value;const activeFm=getActiveFm(v,lid,bid,period)
                          const altFm=(v.alternatives?.length&&activeFm!==v.formula)?activeFm:undefined
                          const dirty=isDirtyCell(v.id,lid,bid,period);const toEdit=varTarget&&inp
                          return(<td key={period} className="border-l border-gray-100 p-0">{inp?<EditableCell value={val} dirty={dirty} toEdit={toEdit} onChange={nv=>handleCellChange(v.id,lid,bid,period,nv)} locked={isCellLocked(period)}/>:<CalcCell value={val} formula={v.formula} altFormula={altFm} activeTriggerId={cs?.activeTriggerId} dirty={dirty} status={cs?.status}/>}</td>)
                        })}
                        {canCompare&&periods.flatMap(period=>{
                          const vCells=orderedCV.map((ver,vi)=>{
                            const key=mk(project.id,ver.id,period,v.id,lid,bid);const cs=cells[key]
                            const val=cs?.value;const activeFm=getActiveFm(v,lid,bid,period,ver.id)
                            const altFm=(v.alternatives?.length&&activeFm!==v.formula)?activeFm:undefined
                            const dirty=isDirtyCell(v.id,lid,bid,period,ver.id);const toEdit=varTarget&&inp
                            return(<td key={`${period}-${ver.id}`} className={`${vi===0?"border-l-2 border-gray-300":"border-l border-gray-100"} p-0`}>{inp?<EditableCell value={val} dirty={dirty} toEdit={toEdit} onChange={nv=>handleCellChange(v.id,lid,bid,period,nv,ver.id)} locked={isCellLocked(period)}/>:<CalcCell value={val} formula={v.formula} altFormula={altFm} activeTriggerId={cs?.activeTriggerId} dirty={dirty} status={cs?.status}/>}</td>)
                          })
                          if(!showDelta)return vCells
                          const vA=cells[mk(project.id,orderedCV[0].id,period,v.id,lid,bid)]?.value
                          const vB=cells[mk(project.id,orderedCV[orderedCV.length-1].id,period,v.id,lid,bid)]?.value
                          return[...vCells,<td key={`${period}-delta`} className="border-l border-indigo-100 bg-indigo-50/30 p-0"><DeltaCell valueA={vA} valueB={vB}/></td>]
                        })}
                      </tr>
                    </>
                    )
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}
      </div>

      {/* ════ Panel 2 ════ */}
      {dualPanel&&(
        <div className="w-1/2 flex flex-col overflow-hidden">

          {/* Version bar panel 2 */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 shrink-0 overflow-x-auto">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider shrink-0">Versão</span>
            {versions.map((ver,idx)=>{
              const col=verColor(ver.colorIdx??idx)
              const isAct=ver.id===panel2ActiveVerId
              return(
                <button key={ver.id} onClick={()=>setPanel2VerId(ver.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all shrink-0
                    ${isAct?`${col.active} border-current bg-white`:"text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                  <span className={`w-2 h-2 rounded-full ${col.dot}`}/>
                  {ver.name}
                </button>
              )
            })}
          </div>

          {/* Filtros painel 2 */}
          <GridFilters project={project}
            filterScope={filterScope2} setFilterScope={setFilterScope2}
            filterType={filterType2}   setFilterType={setFilterType2}
            filterLang={filterLang2}   setFilterLang={setFilterLang2}
            filterLob={filterLob2}     setFilterLob={setFilterLob2}
            filterVar={filterVar2}     setFilterVar={setFilterVar2}/>

          {/* Grid painel 2 */}
          <div className="flex-1 overflow-auto">
            <table className="border-collapse text-sm w-full">
              <thead>
                <tr className="bg-white border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
                  <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-52">Variável</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-24">Âmbito</th>
                  <th className="text-left px-3 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide w-32 border-r border-gray-200">Contexto</th>
                  {periods.map(p=>(<th key={p} className="px-3 py-3 text-center font-semibold text-gray-600 text-xs uppercase tracking-wide min-w-28 border-l border-gray-100">{fmtP(p)}</th>))}
                </tr>
              </thead>
              <tbody>
                {rows2.map((row,idx)=>{
                  const{v,lid,bid,ctx}=row
                  const prev=rows2[idx-1];const isFirst=!prev||prev.v.id!==v.id
                  const next2=rows2[idx+1];const isLast2=!next2||next2.v.id!==v.id
                  const sc=SC[v.scope];const inp=isInput(v)
                  const bCls2=isFirst&&isLast2?"border-t-2 border-t-gray-300 border-b-2 border-b-gray-300"
                             :isFirst?"border-t-2 border-t-gray-300 border-b border-b-gray-100"
                             :isLast2?"border-b-2 border-b-gray-300 border-t-0"
                             :"border-b border-b-gray-100"
                  return(
                    <tr key={`p2-${v.id}-${lid}-${bid}`} className={`transition-colors ${sc.bg} ${bCls2}`}>
                      <td className="px-4 py-2 align-top">
                        {isFirst&&(<div className="relative pr-5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-gray-800">{v.name}</span>
                          </div>
                          <div className="text-xs font-mono mt-0.5 text-gray-400">{v.id}</div>
                          {!inp&&v.formula&&<div className="text-xs text-gray-400 font-mono mt-0.5 max-w-44 truncate" title={v.formula}>{v.formula}</div>}
                        </div>)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {isFirst&&<div className="flex flex-col gap-1"><Badge scope={v.scope}/>{!v.formula&&!v.alternatives?.length&&<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-semibold w-fit">✎ input</span>}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 border-r border-gray-200 align-middle">{ctx}</td>
                      {periods.map(period=>{
                        const key=mk(project.id,panel2ActiveVerId,period,v.id,lid,bid)
                        const cs=cells[key];const val=cs?.value
                        return(
                          <td key={period} className="border-l border-gray-100 p-0">
                            {inp
                              ?<EditableCell value={val} dirty={false} toEdit={false}
                                  onChange={nv=>handleCellChange(v.id,lid,bid,period,nv,panel2ActiveVerId)}/>
                              :<CalcCell value={val} formula={v.formula} altFormula={undefined} activeTriggerId={undefined} dirty={false}/>
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
        </div>
      )}{/* end panel 2 */}

      </div>{/* end main panels */}


      {(hasDirty || undoStack.length > 0)?(
        <footer className="bg-orange-50 border-t border-orange-200 px-5 py-2.5 flex items-center gap-3 text-xs shrink-0">
          <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0"/>
          {(()=>{
            const calcCount = new Set(deltaLog.filter(e=>!e.isEdited).map(e=>e.varCode)).size
            return (
              <span className="text-orange-700 font-medium shrink-0">
                {calcCount} variável{calcCount !== 1 ? "es" : ""} calculada{calcCount !== 1 ? "s" : ""}
                {deltaLog.some(e=>e.isEdited) && (
                  <span className="text-gray-400 font-normal"> · 1 editada</span>
                )}
              </span>
            )
          })()}
          {deltaLog.length > 0 && (
            <button onClick={()=>setShowDeltaLog(true)}
              className="text-orange-600 hover:text-orange-800 underline font-medium shrink-0">
              Ver detalhes
            </button>
          )}

          <div className="flex-1"/>

          {/* Undo stack */}
          {undoStack.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={handleUndo}
                title={undoStack[0]?.label}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-orange-300 text-orange-700 hover:bg-orange-100 rounded-xl font-semibold transition-colors">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.28h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.988a.75.75 0 01-1.036 1.085l-5.5-5.292a.75.75 0 010-1.085l5.5-5.292a.75.75 0 011.061.025z" clipRule="evenodd"/>
                </svg>
                Desfazer
              </button>
              <span className="text-orange-400 font-mono text-[10px]">{undoStack.length}/5</span>
            </div>
          )}

          {/* Gravar — limpa o histórico de undo */}
          <button onClick={()=>{setDirtyKeys(new Set());setDeltaLog([]);setShowDeltaLog(false);setUndoStack([]);setFilterAffected1(false)}}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition-colors shrink-0">
            Gravar
          </button>
        </footer>
      ):(
        <footer className="bg-white border-t border-gray-100 px-5 py-2 flex items-center gap-4 text-xs text-gray-400 shrink-0 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse"/>Input a editar</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block"/>Valor alterado</span>
          {canCompare&&showDelta&&<span className="flex items-center gap-2"><span className="text-indigo-400 font-bold font-mono">Δ</span><span className="text-indigo-400">{deltaLabel}</span></span>}
          <span className="text-gray-500 font-mono">123</span><span>Calculado → hover para fórmula</span>
        </footer>
      )}

      {/* ── Admin panel ── */}
      {showAdmin && (
        <AdminPanel onClose={()=>setShowAdmin(false)}/>
      )}

      {/* ── Nova versão modal ── */}
      {showNewVersion && (
        <NewVersionModal
          versionTypes={versionTypes}
          name={newVerName} setName={setNewVerName}
          typeId={newVerTypeId} setTypeId={setNewVerTypeId}
          onConfirm={handleAddVersion}
          onCancel={()=>setShowNewVersion(false)}/>
      )}

      {/* ── Delta log modal ── */}
      {showDeltaLog && deltaLog.length > 0 && (
        <DeltaLogModal entries={deltaLog} onClose={()=>setShowDeltaLog(false)}/>
      )}

      {/* ── Modals ── */}
      {showTemplate&&(
        <TemplateModal
          initialTemplateId={project ? parseInt(project.templateId.replace('tpl_','')) : null}
          onClose={()=>setShowTemplate(false)}
          onEditVar={v=>{setShowTemplate(false);setModal(v)}}
          onAddVar={tplId=>{setShowTemplate(false);setModal("new")}}/>
      )}
      {showProject && !editingProjectId && (
        <ProjectListPanel
          allProjects={allProjects}
          templates={templates}
          onEdit={id=>setEditingProjectId(id)}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
          onClose={()=>setShowProject(false)}/>
      )}
      {showProject && editingProjectId && (() => {
        const isNew = editingProjectId === 'new'
        const editAp = allProjects.find(p=>p.projectId===editingProjectId)
        const editProj = isNew
          ? { id: '', name: '', templateId: '', languages: [] }
          : editingProjectId === activeProjectId && project
            ? project
            : editAp
              ? { id: `c_${editAp.projectId}`, name: editAp.name, templateId: `tpl_${editAp.templateId}`, languages: [] }
              : null
        if (!editProj && !isNew) { setEditingProjectId(null); return null }
        return (
          <ProjectModal project={editProj} templates={templates} isNew={isNew} activeProjectId={activeProjectId}
            onSave={async p => {
              if (isNew) {
                const rawTplId = parseInt(p.templateId.replace('tpl_',''))
                try {
                  const created = await api.post('/admin/projects', {
                    templateId: rawTplId, code: `proj_${Date.now()}`, name: p.name
                  })
                  setAllProjects(prev => [...prev, created])
                } catch(e) { alert('Erro ao criar projecto: ' + e.message) }
                setEditingProjectId(null)
                setShowProject(false)
              } else {
                handleSaveProject(p)
                setEditingProjectId(null)
              }
            }}
            onClose={()=>setEditingProjectId(null)}/>
        )
      })()}
      {showDict&&<DictModal onClose={()=>setShowDict(false)} onLaunch={handleLaunchFromDict}/>}
      {modal&&<VarModal variable={modal==="new"?null:modal} variables={vars} client={project}
        onSave={handleSaveVar} onClose={()=>setModal(null)}
        onDelete={modal!=="new"?()=>handleDelVar(modal.id):null}/>}
    </div>
  )
}
