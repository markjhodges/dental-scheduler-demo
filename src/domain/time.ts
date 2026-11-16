export type WallTime = { year: number; month: number; day: number; hour: number; minute: number };

export function wallParts(instant: Date, timezone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (key: string) => Number(parts.find(p => p.type === key)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

export function localToUtc(wall: WallTime, timezone: string): Date | null {
  const assumed = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const matches: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(assumed - offset * 60_000);
    const actual = wallParts(candidate, timezone);
    if (Object.keys(wall).every(key => wall[key as keyof WallTime] === actual[key as keyof WallTime])) matches.push(candidate);
  }
  return matches.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

export function localDate(instant: Date, timezone: string) {
  const p = wallParts(instant, timezone);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}

export function localWeekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function onlineChangeAllowed(startsAt: Date, now = new Date()) {
  return startsAt.getTime() - now.getTime() >= 24 * 60 * 60 * 1000;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
