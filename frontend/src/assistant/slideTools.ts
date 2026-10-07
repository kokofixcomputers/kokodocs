import type { SlidesModel } from '../slides/model'
import { chartData, toMatrix } from '../slides/matrix'
import { FONTS, loadFont } from '../fonts'
import { LAYOUTS, THEMES, chartCells, tableDraft, themeById, type ChartKind, type LayoutId } from '../slides/themes'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'

export interface SlideDeps {
  model: SlidesModel
  getCur: () => string
  setCur: (id: string) => void
  getSel: () => string[]
  getTitle: () => string
  canEdit: () => boolean
}

export function createSlidesAdapter(d: SlideDeps): Adapter {
  const m = d.model
  const slideAt = (n: unknown) => {
    const s = m.read(), i = Number(n) - 1
    if (!Number.isInteger(i) || i < 0 || i >= s.length) throw new Error(`There is no slide ${n}. The deck has ${s.length} slide${s.length === 1 ? '' : 's'}.`)
    return s[i]
  }
  const elAt = (slide: ReturnType<typeof slideAt>, n: unknown) => {
    const i = Number(n) - 1
    if (!Number.isInteger(i) || i < 0 || i >= slide.els.length) throw new Error(`Slide has no element ${n}. It has ${slide.els.length}.`)
    return slide.els[i]
  }
  const describe = (si: number) => {
    const s = m.read()[si]
    const lines = s.els.map((e, i) => {
      const where = `at ${Math.round(e.x)},${Math.round(e.y)} size ${Math.round(e.w)}x${Math.round(e.h)}`
      if (e.type === 'text') return `  [${i + 1}] ${e.role ?? 'text'}${e.bullets ? ' (bullets)' : ''} ${where}: ${JSON.stringify(e.text ?? '')}`
      if (e.type === 'table') return `  [${i + 1}] table ${e.nr}x${e.nc} ${where}:\n${toMatrix(e).map((r) => '      | ' + r.join(' | ') + ' |').join('\n')}`
      if (e.type === 'chart') { const d = chartData(e); return `  [${i + 1}] ${e.chart ?? 'column'} chart ${where}${e.text ? ` “${e.text}”` : ''}: ${d.series.map((x) => `${x.name} [${d.cats.map((c, j) => `${c}=${x.values[j]}`).join(', ')}]`).join('; ')}` }
      if (e.type === 'shape') return `  [${i + 1}] shape ${e.shape} ${where}${e.text ? `: ${JSON.stringify(e.text)}` : ''}`
      return `  [${i + 1}] image ${where}${e.alt ? ` (${e.alt})` : ''}`
    })
    return `Slide ${si + 1}${s.bg ? ` (background ${s.bg})` : ''}\n${lines.join('\n') || '  (empty)'}${s.notes.trim() ? `\n  Notes: ${JSON.stringify(s.notes)}` : ''}`
  }

  const readDeck: Tool = tool('read_deck', 'Read the whole presentation: every slide with its numbered elements, text and speaker notes. Do this before editing.', {}, [], {
    label: () => 'Read the presentation',
    run: () => {
      const s = m.read()
      const out = `Presentation “${d.getTitle()}”: ${s.length} slide${s.length === 1 ? '' : 's'}, theme ${themeById(m.theme).name}, canvas 1280x720.\n\n` + s.map((_x, i) => describe(i)).join('\n\n')
      return clip(out, MAX_RESULT_CHARS)
    },
  })
  const readSlide: Tool = tool('read_slide', 'Read one slide (1-based).', { slide: { type: 'number' } }, ['slide'], { label: (a) => `Read slide ${a?.slide}`, run: (a) => { const s = slideAt(a.slide); return describe(m.read().indexOf(s)) } })

  const addSlide: Tool = tool('add_slide', 'Add a designed slide. Pick the layout that fits the content, and fill in the fields that layout uses:\n' +
    LAYOUTS.filter((l) => l.id !== 'blank').map((l) => `- ${l.id}: ${l.hint}`).join('\n') +
    '\nFields by layout: title/closing use title + subtitle. section uses title + subtitle (a small label above). titleContent and split use title + bullets. twoColumn and cards use title + columns [{heading,text}] (text can have several lines). stats uses title + stats [{value,label}] (2 to 4). stat uses title + one stats item + subtitle. quote uses quote + author. steps uses title + steps [{title,text}] (3 to 5).',
    {
      layout: { type: 'string', enum: LAYOUTS.map((l) => l.id) }, title: { type: 'string' }, subtitle: { type: 'string' }, bullets: { type: 'string', description: 'One bullet per line' },
      columns: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, text: { type: 'string' } } } },
      stats: { type: 'array', items: { type: 'object', properties: { value: { type: 'string', description: 'Short, like 82%, $4.2M, 3x' }, label: { type: 'string' } } } },
      quote: { type: 'string' }, author: { type: 'string' },
      steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } } } },
      table: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      chart: { type: 'object', properties: { kind: { type: 'string', enum: ['column', 'bar', 'line', 'area', 'pie'] }, title: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } } } } } },
      notes: { type: 'string', description: 'Speaker notes' }, after: { description: 'Slide number to insert after, or "end" (default)' },
    }, ['layout'], {
      edit: true,
      describe: (a) => ({ title: `Add a ${LAYOUTS.find((l) => l.id === a.layout)?.name.toLowerCase() ?? 'slide'}: “${clip(String(a.title ?? a.quote ?? a.stats?.[0]?.value ?? ''), 50)}”`, detail: [a.subtitle, a.bullets && clip(String(a.bullets), 200), a.columns && `${a.columns.length} columns`, a.stats && `${a.stats.length} numbers`, a.steps && `${a.steps.length} steps`].filter(Boolean).join(' · ') || undefined }),
      run: (a) => {
        const layout = (LAYOUTS.some((l) => l.id === a.layout) ? a.layout : 'titleContent') as LayoutId
        const n = m.read().length
        const after = a.after === undefined || a.after === 'end' ? n - 1 : Math.max(-1, Math.min(n - 1, Number(a.after) - 1))
        const id = m.addSlide(layout, after, { title: a.title, subtitle: a.subtitle, bullets: a.bullets, columns: a.columns, stats: a.stats, quote: a.quote, author: a.author, steps: a.steps, table: a.table, chart: a.chart }, String(a.notes ?? ''))
        d.setCur(id)
        return `Added slide ${m.ids().indexOf(id) + 1} (${layout}). The deck now has ${m.ids().length} slides.`
      },
    })
  const addTable: Tool = tool('add_table', 'Add a table to an existing slide. rows is an array of rows (arrays of strings); the first row is the header.', { slide: { type: 'number' }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, ['slide', 'rows'], {
    edit: true, describe: (a) => ({ title: `Add a ${a.rows?.length ?? 0} row table to slide ${a.slide}`, detail: clip((a.rows ?? []).slice(0, 3).map((r: string[]) => r.join(' | ')).join('\n'), 240) }),
    run: (a) => { const s = slideAt(a.slide); const rows = (a.rows as string[][]).slice(0, 12).map((r) => r.slice(0, 8).map(String)); const n = rows.length; m.addEl(s.id, tableDraft(rows, Number(a.x ?? 80), Number(a.y ?? 200), Number(a.width ?? 1120), Number(a.height ?? Math.min(440, n * 64))) as never); return `Added a ${n} row table.` },
  })
  const addChart: Tool = tool('add_chart', 'Add a chart with the data you provide (nothing is linked to a spreadsheet). One value per category in each series.', { slide: { type: 'number' }, kind: { type: 'string', enum: ['column', 'bar', 'line', 'area', 'pie'] }, title: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } }, series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } } } }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, ['slide', 'kind', 'categories', 'series'], {
    edit: true, describe: (a) => ({ title: `Add a ${a.kind} chart to slide ${a.slide}`, detail: `${a.title ? a.title + ': ' : ''}${(a.categories ?? []).length} categories, ${(a.series ?? []).length} series` }),
    run: (a) => { const s = slideAt(a.slide); const cats = (a.categories as string[]).slice(0, 24), sr = (a.series as { name: string; values: number[] }[]).slice(0, 6); m.addEl(s.id, { type: 'chart', chart: a.kind as ChartKind, text: String(a.title ?? ''), x: Number(a.x ?? 140), y: Number(a.y ?? 190), w: Number(a.width ?? 1000), h: Number(a.height ?? 470), cells: chartCells(cats, sr), nr: cats.length + 1, nc: sr.length + 1, legend: true } as never); return `Added a ${a.kind} chart.` },
  })
  const setCell: Tool = tool('set_table_cell', 'Change one cell of a table or chart data grid (row and column are 1-based; for charts row 1 holds series names and column 1 the category labels).', { slide: { type: 'number' }, element: { type: 'number' }, row: { type: 'number' }, column: { type: 'number' }, text: { type: 'string' } }, ['slide', 'element', 'row', 'column', 'text'], {
    edit: true, describe: (a) => ({ title: `Edit cell ${a.row},${a.column} on slide ${a.slide}`, after: clip(String(a.text ?? ''), 120) }),
    run: (a) => { const s = slideAt(a.slide), e = elAt(s, a.element); if (e.type !== 'table' && e.type !== 'chart') throw new Error('That element is not a table or chart.'); m.setCell(s.id, e.id, Number(a.row) - 1, Number(a.column) - 1, String(a.text)); return 'Updated.' },
  })
  const formatEl: Tool = tool('format_element', 'Adjust one element: font, size, bold, italic, color, alignment, fill, or position and size. The font can be any Google Font by its exact family name (for example "Playfair Display" or "Space Grotesk"), or "theme" to go back to the theme font. Colors can be a theme token (fg, muted, accent, accentInk, bg, card) or a hex like #ff5a36.',
    { slide: { type: 'number' }, element: { type: 'number' }, font: { type: 'string' }, size: { type: 'number' }, bold: { type: 'boolean' }, italic: { type: 'boolean' }, color: { type: 'string' }, fill: { type: 'string' }, align: { type: 'string', enum: ['left', 'center', 'right'] }, valign: { type: 'string', enum: ['top', 'middle', 'bottom'] }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, ['slide', 'element'], {
      edit: true, describe: (a) => ({ title: `Restyle element ${a.element} on slide ${a.slide}`, detail: Object.entries(a).filter(([k]) => !['slide', 'element'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(', ') }),
      run: (a) => {
        const s = slideAt(a.slide), e = elAt(s, a.element)
        const p: Record<string, unknown> = {}
        for (const k of ['size', 'bold', 'italic', 'color', 'fill', 'align', 'valign', 'x', 'y'] as const) if (a[k] !== undefined) p[k] = a[k]
        if (a.width !== undefined) p.w = Number(a.width); if (a.height !== undefined) p.h = Number(a.height)
        if (a.font !== undefined) {
          const f = String(a.font).trim()
          if (f.toLowerCase() === 'theme' || f === '') p.font = undefined
          else { const hit = FONTS.find((x) => x.family.toLowerCase() === f.toLowerCase()); if (!hit) throw new Error(`"${f}" isn't a font I can use. Try another family name.`); p.font = hit.family; loadFont(hit.family) }
        }
        m.updateEl(s.id, e.id, p as never); return 'Updated.'
      },
    })
  const setBg: Tool = tool('set_slide_background', 'Set one slide\'s background color (hex), or "theme" to use the theme background.', { slide: { type: 'number' }, color: { type: 'string' } }, ['slide', 'color'], {
    edit: true, describe: (a) => ({ title: `Set the background of slide ${a.slide} to ${a.color}` }), run: (a) => { m.setBg(slideAt(a.slide).id, a.color === 'theme' ? null : String(a.color)); return 'Updated.' },
  })
  const setText: Tool = tool('set_text', 'Replace the text of one element on a slide (use the numbers from read_deck).', { slide: { type: 'number' }, element: { type: 'number' }, text: { type: 'string' } }, ['slide', 'element', 'text'], {
    edit: true,
    describe: (a) => { let before = ''; try { before = slideAt(a.slide).els[Number(a.element) - 1]?.text ?? '' } catch { /* shown on run */ } return { title: `Edit slide ${a.slide}, element ${a.element}`, before: clip(before, 200), after: clip(String(a.text ?? ''), 300) } },
    run: (a) => { const s = slideAt(a.slide), e = elAt(s, a.element); if (e.type === 'image') throw new Error('That element is an image.'); m.updateEl(s.id, e.id, { text: String(a.text) }); return 'Updated.' },
  })
  const addText: Tool = tool('add_text_box', 'Add a text box to a slide.', { slide: { type: 'number' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, size: { type: 'number' }, bold: { type: 'boolean' } }, ['slide', 'text'], {
    edit: true, describe: (a) => ({ title: `Add a text box to slide ${a.slide}`, after: clip(String(a.text ?? ''), 240) }),
    run: (a) => { const s = slideAt(a.slide); m.addEl(s.id, { type: 'text', x: Number(a.x ?? 140), y: Number(a.y ?? 300), w: Number(a.width ?? 1000), h: Number(a.height ?? 120), text: String(a.text), size: Number(a.size ?? 32), bold: !!a.bold, align: 'left', valign: 'top' }); return 'Added.' },
  })
  const deleteEl: Tool = tool('delete_element', 'Delete one element from a slide.', { slide: { type: 'number' }, element: { type: 'number' } }, ['slide', 'element'], {
    edit: true, describe: (a) => ({ title: `Delete element ${a.element} on slide ${a.slide}` }), run: (a) => { const s = slideAt(a.slide); m.deleteEls(s.id, [elAt(s, a.element).id]); return 'Deleted.' },
  })
  const setNotes: Tool = tool('set_notes', 'Set the speaker notes of a slide.', { slide: { type: 'number' }, notes: { type: 'string' } }, ['slide', 'notes'], {
    edit: true, describe: (a) => ({ title: `Set notes on slide ${a.slide}`, after: clip(String(a.notes ?? ''), 300) }), run: (a) => { m.setNotes(slideAt(a.slide).id, String(a.notes)); return 'Updated.' },
  })
  const deleteSlide: Tool = tool('delete_slide', 'Delete a slide.', { slide: { type: 'number' } }, ['slide'], {
    edit: true, describe: (a) => ({ title: `Delete slide ${a.slide}` }), run: (a) => { if (m.ids().length <= 1) throw new Error('A presentation needs at least one slide.'); m.deleteSlide(slideAt(a.slide).id); return `Deleted. ${m.ids().length} slides left.` },
  })
  const moveSlide: Tool = tool('move_slide', 'Move a slide to a new position (1-based).', { slide: { type: 'number' }, to: { type: 'number' } }, ['slide', 'to'], {
    edit: true, describe: (a) => ({ title: `Move slide ${a.slide} to position ${a.to}` }), run: (a) => { m.moveSlide(slideAt(a.slide).id, Number(a.to) - 1); return 'Moved.' },
  })
  const setTheme: Tool = tool('set_theme', 'Change the theme of the whole deck. Options: ' + THEMES.map((t) => `${t.id} (${t.name})`).join(', ') + '.', { theme: { type: 'string', enum: THEMES.map((t) => t.id) } }, ['theme'], {
    edit: true, describe: (a) => ({ title: `Switch theme to ${themeById(String(a.theme)).name}` }), run: (a) => { if (!THEMES.some((t) => t.id === a.theme)) throw new Error('Unknown theme.'); m.setMeta('theme', String(a.theme)); return 'Theme changed.' },
  })

  return {
    kind: 'slides', noun: 'presentation', title: d.getTitle, canEdit: d.canEdit, undo: () => { m.undo.undo() },
    guide: `You are designing slides on a 1280x720 canvas. Read the deck with read_deck, edit with the slide tools. Slide and element numbers are 1-based and shift after inserts or deletes.

DESIGN RULES (follow them; plain bullet slides are the failure mode):
- Plan first. Before adding anything, decide the story: opening, 3 to 6 sections, closing. Write a one-line plan in your reply, then build it.
- Choose a theme that suits the subject with set_theme before adding slides (mono for clean business, night for tech or evening talks, paper for editorial or books, ocean for data and finance, forest for sustainability or health, sunset for creative and consumer). Keep one theme for the whole deck.
- NEVER use the same layout twice in a row, and use titleContent at most once per 4 slides. Mix: title, then a section or stat opener, cards, steps, two columns, quote, split, key numbers, and end with closing.
- Match layout to content: processes and timelines use steps; three parallel ideas use cards; comparisons use twoColumn; any impressive figure uses stat or stats (value like 82% or $4.2M, never a sentence); a memorable line or testimonial uses quote; chapter breaks use section; title and closing frame the deck.
- Tables are for real comparisons (3 to 6 rows, 2 to 5 columns of short cells). Charts are for numbers over time or shares of a whole: use a chart layout or add_chart with the real figures, one category per row, and never invent data you were not given without saying so.
- Be brief. Titles are 2 to 6 words and say something (a claim beats a topic: "Sales doubled in Q3" not "Sales"). Bullets are fragments of at most 8 words, 3 to 5 per slide. Card and step text is one short sentence. Put the detail in the speaker notes (2 to 4 sentences per slide) so the slide stays clean.
- Use real, specific content, and numbers when you have them. Never write filler like "Lorem ipsum", "Add details here" or "Key point 1".
- Keep text short enough to fit: a card text under 120 characters, a stat label under 40.
- When asked to improve an existing deck, change the layout (delete and re-add slides in a better layout) instead of only editing words.
- After building, summarize in two sentences what you made. Do not repeat the content of every slide.`,
    context: () => { const s = m.read(), i = s.findIndex((x) => x.id === d.getCur()); const sel = d.getSel(); return `The user is looking at slide ${i + 1} of ${s.length}${sel.length ? ` with ${sel.length} element${sel.length === 1 ? '' : 's'} selected` : ''}.` },
    suggestions: ['Design a 7-slide pitch deck about my idea', 'Summarize this deck', 'Make this deck more visual', 'Write speaker notes for each slide'],
    tools: [readDeck, readSlide, addSlide, setText, addText, addTable, addChart, setCell, formatEl, setBg, deleteEl, setNotes, deleteSlide, moveSlide, setTheme],
  }
}
