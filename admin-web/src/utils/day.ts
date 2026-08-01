import dayjs from 'dayjs'

interface DateParams {
  year: number
  month: number
}

interface DaysInMonthParams {
  year?: number
  month?: number
}

export function formatDate(date: Date = new Date(), format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dayjs(date).format(format)
}

export function getFirstDayOfMonth({ year, month }: DateParams): Date {
  return new Date(year, month, 1)
}

export function getDaysInMonth({ year = dayjs().year(), month = dayjs().month() + 1 }: DaysInMonthParams = {}): number {
  if (month < 1 || month > 12) {
    throw new Error('月份必须在 1 到 12 之间')
  }

  return dayjs(`${year}-${month}-01`).daysInMonth()
}

export function getLastDayOfMonth({ year, month }: DateParams): Date {
  return new Date(year, month, getDaysInMonth({ year, month: month + 1 }))
}
