export type TurnPlanStep = {
  step: string
  status: string
}

export type TurnPlanItem = {
  id: string
  type: 'turnPlan'
  steps: TurnPlanStep[]
  explanation?: string
  status: string
}

export function turnPlanItemId(turnId: string) {
  return `turn-plan-${turnId}`
}

export function normalizeTurnPlanStatus(value?: string | null) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export function readTurnPlanExplanation(value: unknown) {
  return stringField(asObject(value).explanation).trim()
}

export function readTurnPlanSteps(value: unknown): TurnPlanStep[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .map((entry) => ({
      step: stringField(entry.step).trim(),
      status: stringField(entry.status).trim(),
    }))
    .filter((entry) => entry.step)
}

export function deriveTurnPlanStatus(steps: TurnPlanStep[]) {
  if (!steps.length) {
    return ''
  }

  let allCompleted = true
  for (const entry of steps) {
    switch (normalizeTurnPlanStatus(entry.status)) {
      case 'completed':
        continue
      case 'inprogress':
        return 'inProgress'
      default:
        allCompleted = false
    }
  }

  return allCompleted ? 'completed' : 'pending'
}

export function buildTurnPlanItem(turnId: string, payload: Record<string, unknown>): TurnPlanItem {
  const steps = readTurnPlanSteps(payload.plan)
  const explanation = readTurnPlanExplanation(payload)
  return {
    id: turnPlanItemId(turnId),
    type: 'turnPlan',
    steps,
    explanation: explanation || undefined,
    status: deriveTurnPlanStatus(steps),
  }
}

export function readTurnPlanItem(value: unknown): TurnPlanItem | null {
  const item = asObject(value)
  if (stringField(item.type) !== 'turnPlan') {
    return null
  }

  const steps = readTurnPlanSteps(item.steps)
  const explanation = readTurnPlanExplanation(item)
  return {
    id: stringField(item.id),
    type: 'turnPlan',
    steps,
    explanation: explanation || undefined,
    status: stringField(item.status).trim() || deriveTurnPlanStatus(steps),
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}
