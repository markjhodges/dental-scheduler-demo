import test from 'node:test';
import assert from 'node:assert/strict';
import { localToUtc, onlineChangeAllowed, overlaps, wallParts } from '../src/domain/time';

test('online change includes the exact 24-hour boundary',()=>{
  const now=new Date('2026-11-15T17:00:00Z');
  assert.equal(onlineChangeAllowed(new Date('2026-11-16T17:00:00Z'),now),true);
  assert.equal(onlineChangeAllowed(new Date('2026-11-16T16:59:59.999Z'),now),false);
});

test('spring daylight-saving gap does not create a fake appointment time',()=>{
  assert.equal(localToUtc({year:2026,month:3,day:8,hour:2,minute:30},'America/Los_Angeles'),null);
  assert.equal(localToUtc({year:2026,month:3,day:8,hour:3,minute:30},'America/Los_Angeles')?.toISOString(),'2026-03-08T10:30:00.000Z');
});

test('fall repeated hour uses the first occurrence consistently',()=>{
  const instant=localToUtc({year:2026,month:11,day:1,hour:1,minute:30},'America/Los_Angeles');
  assert.equal(instant?.toISOString(),'2026-11-01T08:30:00.000Z');
  assert.deepEqual(wallParts(instant!,'America/Los_Angeles'),{year:2026,month:11,day:1,hour:1,minute:30});
});

test('back-to-back resource allocations do not overlap',()=>{
  const d=(value:string)=>new Date(value);
  assert.equal(overlaps(d('2026-01-01T09:00Z'),d('2026-01-01T10:00Z'),d('2026-01-01T10:00Z'),d('2026-01-01T11:00Z')),false);
  assert.equal(overlaps(d('2026-01-01T09:00Z'),d('2026-01-01T10:01Z'),d('2026-01-01T10:00Z'),d('2026-01-01T11:00Z')),true);
});
