import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fieldDisplay, fieldValue, mergeFieldValues, sanitiseFieldDef, todoGridColumns, type TodoFieldDef } from '../app/lib/todo-fields-core'
import { groupTodosBy, sanitiseTodoPatch } from '../app/lib/todo-core'

const progress: TodoFieldDef = { id: 'f1', name: 'Task Progress', type: 'select', options: [{ id: 'a', name: 'For Approval', colour: '#eec300' }, { id: 'b', name: 'Done', colour: '#62d26f' }] }
const notes: TodoFieldDef = { id: 'f2', name: 'Notes', type: 'text' }

describe("Asana's custom fields and project sections on to-dos (20 Oct 2026)", () => {
  it('a field is named, typed, and a dropdown has options with colours', () => {
    expect(sanitiseFieldDef({ name: '', type: 'select' }).ok).toBe(false)
    expect(sanitiseFieldDef({ name: 'Priority', type: 'select', options: [] }).ok).toBe(false)
    const ok = sanitiseFieldDef({ name: 'Priority', type: 'select', options: [{ name: 'High', colour: '#e8384f' }, { name: 'Low' }] })
    expect(ok.ok && ok.def.options?.map(o => o.name)).toEqual(['High', 'Low'])
    expect(ok.ok && ok.def.options?.[1].colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('a value must be one its field can hold; null clears it; unknown fields are dropped', () => {
    expect(fieldValue(progress, 'a')).toBe('a')
    expect(fieldValue(progress, 'zzz')).toBeUndefined()
    expect(mergeFieldValues({ f1: 'a', gone: 'x' }, { f2: 'hello', f1: null }, [progress, notes])).toEqual({ f2: 'hello' })
    expect(fieldDisplay(progress, 'a')).toEqual({ text: 'For Approval', colour: '#eec300' })
  })

  it('a project groups by its own sections, in order, with the loose ones first', () => {
    const rows = [{ id: '1', title: 'x', project_section_id: 's2' }, { id: '2', title: 'y', project_section_id: null }] as never[]
    const g = groupTodosBy(rows, 'project', { today: '2026-10-20', sort: 'due', sections: [], nameOf: () => '', clientOf: () => '', projectSections: [{ id: 's1', name: 'Core Deliverables' }, { id: 's2', name: 'Editing Queu' }] })
    expect(g.map(x => [x.label, x.rows.length])).toEqual([['Untitled section', 1], ['Core Deliverables', 0], ['Editing Queu', 1]])
  })

  it('the to-do save takes fields and a project section; the list gets a column per field', () => {
    const ok = sanitiseTodoPatch({ fields: { f1: 'a' }, project_section_id: 's1' })
    expect(ok.ok && ok.patch).toMatchObject({ fields: { f1: 'a' }, project_section_id: 's1' })
    expect(sanitiseTodoPatch({ fields: 'nope' }).ok).toBe(false)
    expect(todoGridColumns(3).split(' ')).toHaveLength(7)
  })

  it('the routes are signed in, and only a manager adds or changes a field', () => {
    const mw = readFileSync('middleware.ts', 'utf8')
    expect(mw).toContain("'/api/todo-fields(.*)'")
    expect(mw).toContain("'/api/todo-project-sections(.*)'")
    expect(readFileSync('app/api/todo-fields/route.ts', 'utf8')).toContain("requireRole('account_manager')")
  })
})
