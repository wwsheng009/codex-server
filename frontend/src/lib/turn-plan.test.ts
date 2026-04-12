import { describe, expect, it } from 'vitest'

import {
  buildTurnPlanItem,
  deriveTurnPlanStatus,
  normalizeTurnPlanStatus,
  readTurnPlanItem,
  readTurnPlanSteps,
  turnPlanItemId,
} from './turn-plan'

describe('turn-plan', () => {
  it('normalizes turn plan statuses across formatting variants', () => {
    expect(normalizeTurnPlanStatus('inProgress')).toBe('inprogress')
    expect(normalizeTurnPlanStatus('in_progress')).toBe('inprogress')
    expect(normalizeTurnPlanStatus(' In Progress ')).toBe('inprogress')
  })

  it('reads turn plan steps from unknown payload values', () => {
    expect(
      readTurnPlanSteps([
        {
          step: 'Inspect runtime events',
          status: 'completed',
        },
        {
          step: '  ',
          status: 'pending',
        },
      ]),
    ).toEqual([
      {
        step: 'Inspect runtime events',
        status: 'completed',
      },
    ])
  })

  it('derives aggregate plan status from step states', () => {
    expect(deriveTurnPlanStatus([])).toBe('')
    expect(
      deriveTurnPlanStatus([
        { step: 'Inspect', status: 'completed' },
        { step: 'Render', status: 'completed' },
      ]),
    ).toBe('completed')
    expect(
      deriveTurnPlanStatus([
        { step: 'Inspect', status: 'completed' },
        { step: 'Render', status: 'inProgress' },
      ]),
    ).toBe('inProgress')
    expect(
      deriveTurnPlanStatus([
        { step: 'Inspect', status: 'pending' },
      ]),
    ).toBe('pending')
  })

  it('builds stable turn plan items from runtime payloads', () => {
    expect(
      buildTurnPlanItem('turn-1', {
        explanation: 'Stabilize the event pipeline',
        plan: [
          {
            step: 'Inspect runtime events',
            status: 'completed',
          },
          {
            step: 'Render step badges',
            status: 'inProgress',
          },
        ],
      }),
    ).toEqual({
      id: turnPlanItemId('turn-1'),
      type: 'turnPlan',
      explanation: 'Stabilize the event pipeline',
      status: 'inProgress',
      steps: [
        {
          step: 'Inspect runtime events',
          status: 'completed',
        },
        {
          step: 'Render step badges',
          status: 'inProgress',
        },
      ],
    })
  })

  it('reads normalized turn plan items from timeline records', () => {
    expect(
      readTurnPlanItem({
        id: 'turn-plan-turn-1',
        type: 'turnPlan',
        explanation: 'Ship the fix',
        steps: [
          {
            step: 'Write tests',
            status: 'completed',
          },
        ],
      }),
    ).toEqual({
      id: 'turn-plan-turn-1',
      type: 'turnPlan',
      explanation: 'Ship the fix',
      status: 'completed',
      steps: [
        {
          step: 'Write tests',
          status: 'completed',
        },
      ],
    })
  })
})
