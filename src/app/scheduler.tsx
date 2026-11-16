'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Actor = {id:string;display_name:string;role:'patient'|'staff'|'dentist'|'admin'};
type Patient = {id:string;first_name:string;last_name:string;birth_date:string;recare_due:string|null;last_xray:string|null};
type PatientChoice = {patient_id:string;relationship:string;patient:Patient};
type Provider = {id:string;name:string;kind:string;color:string};
type VisitType = {id:string;name:string;duration_minutes:number|null;immediate_booking:boolean;intake_guidance:string|null};
type Slot = {startsAt:string;endsAt:string;hygienistId:string|null;dentistId:string|null;operatoryId:string;ruleVersion:number};
type Appointment = {id:string;patient_id:string;appointment_type_id:string;starts_at:string;ends_at:string;hygienist_id:string|null;dentist_id:string|null;operatory_id:string;status:string;xray_preference:string|null;procedures:string[]};
type Plan = {id:string;title:string;diagnosing_dentist_id:string;diagnosingDentist:{name:string;active:boolean}|null;visits:{description:string;sequence:number}[];estimateStatus:string};
type Feedback = {id:string;appointment_id:string;provider_id:string;stars:number;comment:string|null};
type RecareMilestone = {procedure_key:string;procedure_name:string;category:'routine'|'imaging';last_completed_on:string|null;due_on:string|null};
type Profile = {patient:Patient;appointments:Appointment[];plans:Plan[];favorites:string[];feedback:Feedback[];recordRequests:{id:string;status:string;created_at:string}[];recare:{insuranceName:string|null;milestones:RecareMilestone[]};coverageStatus:string};
type Catalog = {types:VisitType[];providers:Provider[];rooms:{id:string;name:string}[];ruleVersion:number};
type Session = {actor:Actor;mode:string;features:{treatmentRequests:boolean}};
type Intent = {id:string;expiresAt:string;status:string;holdGuaranteed:boolean};

async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const response = await fetch(`/api/v1${path}`,{credentials:'same-origin',...init,headers:{'content-type':'application/json',...init?.headers}});
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? data.error ?? 'Request failed.');
  return data as T;
}
function post<T>(path:string,data:unknown,key?:string) {
  return api<T>(path,{method:'POST',body:JSON.stringify(data),headers:key?{'idempotency-key':key}:{}});
}
function dayString(offset=0) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=(key:string)=>parts.find(p=>p.type===key)?.value??'';
  const base=new Date(`${value('year')}-${value('month')}-${value('day')}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate()+offset);
  return base.toISOString().slice(0,10);
}
function dateLabel(value:string) { return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'America/Los_Angeles'}).format(new Date(value)); }
function timeLabel(value:string) { return new Intl.DateTimeFormat('en-US',{timeStyle:'short',timeZone:'America/Los_Angeles'}).format(new Date(value)); }
function monthString(offset=0) { const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

export default function Scheduler() {
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [patients,setPatients]=useState<PatientChoice[]>([]);
  const [selectedPatient,setSelectedPatient]=useState('');
  const [profile,setProfile]=useState<Profile|null>(null);
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [tab,setTab]=useState<'overview'|'booking'|'admin'|'dentist'>('overview');
  const [typeId,setTypeId]=useState('adult-cleaning');
  const [providerId,setProviderId]=useState('');
  const [searchDate,setSearchDate]=useState(dayString(1));
  const [slots,setSlots]=useState<Slot[]>([]);
  const [intent,setIntent]=useState<Intent|null>(null);
  const [sourceAppointment,setSourceAppointment]=useState<Appointment|null>(null);
  const [pendingOperation,setPendingOperation]=useState('');
  const [xray,setXray]=useState<'yes'|'no'|'discuss'>('discuss');
  const [authName,setAuthName]=useState('');
  const [authDob,setAuthDob]=useState('');
  const [authPhone,setAuthPhone]=useState('');
  const [authChannel,setAuthChannel]=useState<'sms'|'email'>('sms');
  const [challenge,setChallenge]=useState('');
  const [authCode,setAuthCode]=useState('');
  const [demoInbox,setDemoInbox]=useState<{body:string;destination:string}[]>([]);

  const refreshSession=useCallback(async()=>{
    try { const result=await api<Session>('/me');setSession(result);return result; }
    catch {setSession(null);return null;}
  },[]);
  const refreshProfile=useCallback(async(patientId:string)=>{
    if (!patientId) return;
    const result=await api<Profile>(`/patients/${patientId}`);setProfile(result);
  },[]);
  useEffect(()=>{(async()=>{
    const current=await refreshSession();
    if (current) {
      const [list,types]=await Promise.all([api<{patients:PatientChoice[]}>('/patients'),api<Catalog>('/catalog')]);
      setPatients(list.patients);setCatalog(types);
      if (list.patients[0]) setSelectedPatient(list.patients[0].patient_id);
      if (current.actor.role==='admin'||current.actor.role==='staff') setTab('admin');
      if (current.actor.role==='dentist') setTab('dentist');
    }
    setLoading(false);
  })().catch(e=>{setError(String(e));setLoading(false);});},[refreshSession]);
  useEffect(()=>{refreshProfile(selectedPatient).catch(e=>setError(e.message));},[selectedPatient,refreshProfile]);
  useEffect(()=>{
    if(!pendingOperation)return;
    const timer=window.setInterval(async()=>{
      try {
        const result=await api<{state:string;error:string|null}>(`/operations/${pendingOperation}`);
        if(result.state==='succeeded') {setPendingOperation('');setNotice('Appointment change confirmed.');await refreshProfile(selectedPatient);}
        if(result.state==='rejected') {setPendingOperation('');setError(`Appointment change could not be confirmed: ${result.error??'please contact the practice'}.`);}
      } catch {/* keep the pending state until the next check */}
    },5000);
    return()=>window.clearInterval(timer);
  },[pendingOperation,refreshProfile,selectedPatient]);

  async function action(fn:()=>Promise<void>):Promise<boolean> {
    setBusy(true);setError('');setNotice('');
    try { await fn(); return true; } catch(e) { setError(e instanceof Error?e.message:'Request failed.'); return false; }
    finally {setBusy(false);}
  }
  async function enterDemo(accountId:string) {
    await action(async()=>{await post('/demo/login',{accountId});window.location.reload();});
  }
  async function logout() { await action(async()=>{await post('/logout',{});window.location.reload();}); }
  async function startVerification() {
    await action(async()=>{
      const names=authName.trim().split(/\s+/);if(names.length<2) throw new Error('Enter a first and last name.');
      const result=await post<{challengeId:string;message:string}>('/auth/start',{
        firstName:names[0],lastName:names.slice(1).join(' '),birthDate:authDob,phone:authPhone||undefined,channel:authChannel});
      setChallenge(result.challengeId);setNotice(result.message);
    });
  }
  async function verify() {await action(async()=>{await post('/auth/verify',{challengeId:challenge,code:authCode});window.location.reload();});}
  async function loadInbox() {await action(async()=>{
    const result=await api<{messages:{body:string;destination:string}[]}>('/demo/inbox');setDemoInbox(result.messages);
  });}
  async function search() {
    await action(async()=>{
      setIntent(null);
      const to=new Date(`${searchDate}T12:00:00`);to.setDate(to.getDate()+6);
      const end=`${to.getFullYear()}-${String(to.getMonth()+1).padStart(2,'0')}-${String(to.getDate()).padStart(2,'0')}`;
      const params=new URLSearchParams({type:typeId,from:searchDate,to:end});
      if(providerId) params.set('provider',providerId);
      if(sourceAppointment) params.set('source',sourceAppointment.id);
      const result=await api<{slots:Slot[]}>(`/availability?${params}`);setSlots(result.slots);
      if(!result.slots.length) setNotice('No matching times were found. Try another week or provider.');
    });
  }
  async function choose(slot:Slot) {
    await action(async()=>{
      const result=await post<Intent>('/intents',{patientId:selectedPatient,appointmentTypeId:typeId,slot,
        xrayPreference:xray,sourceAppointmentId:sourceAppointment?.id});
      setIntent(result);setNotice('Time selected. It is pending until the practice system confirms it.');
    });
  }
  async function confirm() {
    if(!intent) return;
    await action(async()=>{
      let result:{state:string;appointment?:Appointment;operationId:string};
      try {result=await post<{state:string;appointment?:Appointment;operationId:string}>(`/intents/${intent.id}/confirm`,{},crypto.randomUUID());}
      catch(error) {setIntent(null);setSlots([]);throw error;}
      setIntent(null);setSlots([]);setSourceAppointment(null);
      await refreshProfile(selectedPatient);
      setTab('overview');
      if(result.state==='reconciling')setPendingOperation(result.operationId);
      setNotice(result.state==='succeeded'?'Appointment confirmed.':'The result is being checked with the practice system. The original appointment remains until confirmed.');
    });
  }
  async function cancel(appointment:Appointment) {
    if(!window.confirm('Cancel this appointment?')) return;
    await action(async()=>{
      const result=await post<{state:string;operationId:string}>(`/appointments/${appointment.id}/cancel`,{},crypto.randomUUID());
      await refreshProfile(selectedPatient);
      if(result.state==='reconciling')setPendingOperation(result.operationId);
      setNotice(result.state==='succeeded'?'Appointment cancelled.':'Cancellation is being checked. The original appointment remains visible until confirmed.');
    });
  }
  function move(appointment:Appointment) {
    setSourceAppointment(appointment);setTypeId(appointment.appointment_type_id);setSlots([]);setIntent(null);setTab('booking');
    setNotice('Choose a new time. Your original appointment stays in place until the change is confirmed.');
  }
  async function favorite(provider:Provider, yes:boolean) {
    await action(async()=>{await post('/favorites',{patientId:selectedPatient,providerId:provider.id,favorite:yes});
      await refreshProfile(selectedPatient);});
  }
  async function submitFeedback(appointmentId:string,providerId:string,stars:number,comment:string) {
    return action(async()=>{
      await post('/feedback',{patientId:selectedPatient,appointmentId,providerId,stars,comment:comment||null});
      await refreshProfile(selectedPatient);setNotice('Feedback submitted.');
    });
  }
  async function recordRequest() {
    await action(async()=>{await post('/record-requests',{patientId:selectedPatient});await refreshProfile(selectedPatient);setNotice('Your record request was sent to the practice for review.');});
  }
  async function treatmentRequest(planId:string) {
    await action(async()=>{await post(`/treatment/${planId}/request`,{patientId:selectedPatient});setNotice('Your request was sent to staff for review.');});
  }
  const upcoming=useMemo(()=>profile?.appointments.filter(a=>a.status==='confirmed' && new Date(a.starts_at)>new Date()).sort((a,b)=>a.starts_at.localeCompare(b.starts_at))??[],[profile]);
  const history=useMemo(()=>profile?.appointments.filter(a=>a.status==='completed'||new Date(a.starts_at)<=new Date()).sort((a,b)=>b.starts_at.localeCompare(a.starts_at))??[],[profile]);
  const selectedType=catalog?.types.find(t=>t.id===typeId);
  const providerName=(id:string|null)=>catalog?.providers.find(p=>p.id===id)?.name??'Provider';
  const typeName=(id:string)=>catalog?.types.find(t=>t.id===id)?.name??id;
  const canChange=(a:Appointment)=>new Date(a.starts_at).getTime()-Date.now()>=86_400_000;
  const familiarCounts=new Map<string,number>();
  for(const appointment of history.filter(a=>a.status==='completed')) for(const provider of [appointment.hygienist_id,appointment.dentist_id]) {
    if(provider) familiarCounts.set(provider,(familiarCounts.get(provider)??0)+1);
  }
  const preferredProvider=[...familiarCounts].sort((a,b)=>b[1]-a[1])[0]?.[0];

  return <div className="app-shell">
    <header className="site-header"><div className="brand"><span className="brand-mark" aria-hidden="true">✦</span><div><strong>Cypress Dental</strong><small>Independent scheduling concept</small></div></div>
      <div className="header-right"><span className="demo-pill">SYNTHETIC DEMO</span>{session&&<><span className="signed-in">{session.actor.display_name}</span><button className="text-button" onClick={logout} disabled={busy}>Sign out</button></>}</div></header>
    <main id="main" className="main-wrap">
      {loading ? <p>Loading scheduler…</p> : !session ? <>
        <section className="welcome"><div className="eyebrow">A CLEARER WAY TO PLAN CARE</div><h1>Your next visit, made simple.</h1>
          <p>Explore a fictional dental practice through a patient-first scheduling concept. Every patient, appointment, message, and treatment plan here is synthetic.</p></section>
        <div className="login-grid"><section className="panel"><h2>Explore the demo</h2><p>Choose a fictional role to see the patient and practice workflows.</p>
          <div className="persona-list">
            <button onClick={()=>enterDemo('10000000-0000-4000-8000-000000000001')} disabled={busy}><b>Morgan Example</b><span>Patient · guardian of Casey</span></button>
            <button onClick={()=>enterDemo('10000000-0000-4000-8000-000000000002')} disabled={busy}><b>Taylor Example</b><span>Patient · shared phone, separate access</span></button>
            <button onClick={()=>enterDemo('10000000-0000-4000-8000-000000000003')} disabled={busy}><b>Practice Owner</b><span>Calendar, review queue, feedback</span></button>
            <button onClick={()=>enterDemo('10000000-0000-4000-8000-000000000004')} disabled={busy}><b>Front Desk</b><span>Calendar and review queue</span></button>
            <button onClick={()=>enterDemo('10000000-0000-4000-8000-000000000005')} disabled={busy}><b>Dr. Avery Lin</b><span>Dentist · treatment duration settings</span></button>
          </div></section>
          <section className="panel"><h2>Verify a patient record</h2><p>Try matching a fictional name and birth date. Codes go to the local demo inbox.</p>
            <label>Full name<input value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="Morgan Example" /></label>
            <label>Date of birth<input type="date" value={authDob} onChange={e=>setAuthDob(e.target.value)} /></label>
            <label>Phone on file, if needed<input value={authPhone} onChange={e=>setAuthPhone(e.target.value)} placeholder="555-0101" /></label>
            <label>Verification channel<select value={authChannel} onChange={e=>setAuthChannel(e.target.value as 'sms'|'email')}><option value="sms">Text message</option><option value="email">Email</option></select></label>
            <button className="primary" onClick={startVerification} disabled={busy||!authName||!authDob}>Send code</button>
            <button className="text-button inbox-button" onClick={loadInbox} disabled={busy}>Open demo inbox</button>
            {demoInbox.length>0&&<div className="demo-inbox">{demoInbox.map((m,i)=><p key={i}><b>{m.destination}</b><span>{m.body}</span></p>)}</div>}
            {challenge&&<div className="verify-step"><label>Eight digit code<input inputMode="numeric" value={authCode} onChange={e=>setAuthCode(e.target.value)} /></label><button onClick={verify} disabled={busy||authCode.length!==8}>Verify and sign in</button></div>}
            <p className="muted">If contact details are out of date or the match is ambiguous, call the practice for staff review.</p>
          </section></div>
      </> : <>
        <section className="hero"><div><div className="eyebrow">{session.actor.role==='patient'?'PATIENT PORTAL':'PRACTICE WORKSPACE'}</div>
          <h1>{session.actor.role==='patient'?`Welcome back, ${session.actor.display_name.split(' ')[0]}.`:'Care starts with a clear schedule.'}</h1>
          <p>{session.actor.role==='patient'?'See upcoming care, find a familiar provider, and manage eligible visits.':'Manage the provider calendar and the requests that need a person to review them.'}</p></div>
          {session.actor.role==='patient'&&<button className="primary hero-button" onClick={()=>{setTab('booking');setSourceAppointment(null);}}>Find a time <span aria-hidden="true">→</span></button>}</section>
        <nav className="tabs" aria-label="Main navigation">
          {session.actor.role==='patient'&&<><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button><button className={tab==='booking'?'active':''} onClick={()=>setTab('booking')}>Book a visit</button></>}
          {(session.actor.role==='admin'||session.actor.role==='staff')&&<button className={tab==='admin'?'active':''} onClick={()=>setTab('admin')}>Practice workspace</button>}
          {session.actor.role==='dentist'&&<button className={tab==='dentist'?'active':''} onClick={()=>setTab('dentist')}>Treatment settings</button>}
        </nav>
        {patients.length>0&&<div className="patient-select"><label>Viewing care for <select value={selectedPatient} onChange={e=>{setSelectedPatient(e.target.value);setSlots([]);setIntent(null);}}>
          {patients.map(p=><option key={p.patient_id} value={p.patient_id}>{p.patient.first_name} {p.patient.last_name}{p.relationship==='guardian'?' · linked child':''}</option>)}</select></label></div>}
        {tab==='overview'&&profile&&<div className="two-columns"><div className="overview-main"><section className="panel"><div className="section-heading"><div><span className="eyebrow">ON THE CALENDAR</span><h2>Upcoming visits</h2></div><button className="link-button" onClick={()=>setTab('booking')}>Book another →</button></div>
          {upcoming.length?upcoming.map(a=><article className="appointment-card" key={a.id}><div className="date-block"><strong>{dateLabel(a.starts_at)}</strong><span>{timeLabel(a.starts_at)}–{timeLabel(a.ends_at)}</span></div>
            <div className="appointment-detail"><b>{typeName(a.appointment_type_id)}</b><span>{[a.hygienist_id,a.dentist_id].filter(Boolean).map(providerName).join(' · ')}</span>
              {a.xray_preference&&<small>Imaging preference: {a.xray_preference}</small>}</div>
            <div className="appointment-actions">{canChange(a)?<><button onClick={()=>move(a)}>Move</button><button onClick={()=>cancel(a)} disabled={busy}>Cancel</button></>:<span className="muted">Call the practice to change this visit.</span>}</div></article>):<div className="empty"><strong>No upcoming appointments</strong><p>Find a time that works for you.</p></div>}
          </section>
          <HistoryPanel key={selectedPatient} appointments={history} feedback={profile.feedback} providers={catalog?.providers??[]} busy={busy} onSubmit={submitFeedback}/>
          </div><aside className="side-stack"><RecarePanel key={selectedPatient} recare={profile.recare}/>
            <section className="panel"><span className="eyebrow">TREATMENT PLANS</span><h2>Recommended care</h2>{profile.plans.length?profile.plans.map(plan=><article className="plan-card" key={plan.id}><h3>{plan.title}</h3><p>Diagnosing dentist: {plan.diagnosingDentist?.name??'Dentist'}{plan.diagnosingDentist&&!plan.diagnosingDentist.active?' · no longer with practice; staff review required':''}</p><ol>{plan.visits.map(v=><li key={v.sequence}>{v.description}</li>)}</ol><div className="callout">No validated cost estimate is available. Predicted costs can change. Online treatment booking is under review.</div>
              {session.features.treatmentRequests&&<button onClick={()=>treatmentRequest(plan.id)} disabled={busy}>Request staff review</button>}</article>):<p>No treatment plans recorded.</p>}</section>
            <section className="panel"><span className="eyebrow">PREFERRED PEOPLE</span><h2>Your providers</h2>{catalog?.providers.slice().sort((a,b)=>Number(profile.favorites.includes(b.id))-Number(profile.favorites.includes(a.id)) || (familiarCounts.get(b.id)??0)-(familiarCounts.get(a.id)??0)).map(p=><div className="provider-row" key={p.id}><span className="provider-dot" style={{background:p.color}}/><span>{p.name}<small>{p.id===preferredProvider?'Most familiar · ':''}{familiarCounts.get(p.id)?`${familiarCounts.get(p.id)} prior visit${familiarCounts.get(p.id)===1?'':'s'}`:p.kind}</small></span><button aria-label={`${profile.favorites.includes(p.id)?'Remove':'Add'} ${p.name} ${profile.favorites.includes(p.id)?'from':'to'} favorites`} onClick={()=>favorite(p,!profile.favorites.includes(p.id))} disabled={busy}>{profile.favorites.includes(p.id)?'★':'☆'}</button></div>)}</section>
            <section className="panel"><h2>Need your records?</h2><p>Send a request to the practice for review and fulfillment.</p><button onClick={recordRequest} disabled={busy}>Request records</button>{profile.recordRequests?.map(r=><div className="task-row" key={r.id}><small>{dateLabel(r.created_at)} · {r.status}</small></div>)}</section>
          </aside></div>}
        {tab==='booking'&&<div className="two-columns booking-layout"><section className="panel"><span className="eyebrow">FIND YOUR VISIT</span><h2>{sourceAppointment?'Move your appointment':'Book an appointment'}</h2>
          <p className="muted">Times shown are candidates. Your appointment is confirmed only when the practice system accepts it.</p>
          {sourceAppointment&&<div className="callout">Current visit: {dateLabel(sourceAppointment.starts_at)} at {timeLabel(sourceAppointment.starts_at)}. <button className="text-button" onClick={()=>{setSourceAppointment(null);setSlots([]);}}>Stop moving</button></div>}
          <div className="form-grid"><label>Visit type<select value={typeId} disabled={!!sourceAppointment} onChange={e=>{setTypeId(e.target.value);setSlots([]);}}>{catalog?.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label>Preferred provider<select value={providerId} onChange={e=>setProviderId(e.target.value)}><option value="">Any eligible provider</option>{catalog?.providers.slice().sort((a,b)=>Number(profile?.favorites.includes(b.id))-Number(profile?.favorites.includes(a.id)) || (familiarCounts.get(b.id)??0)-(familiarCounts.get(a.id)??0)).map(p=><option key={p.id} value={p.id}>{profile?.favorites.includes(p.id)?'★ ':''}{p.name}{p.id===preferredProvider?' · familiar':''}</option>)}</select></label>
            <label>Starting date<input type="date" min={dayString()} value={searchDate} onChange={e=>setSearchDate(e.target.value)} /></label>
            <label>X-ray preference<select value={xray} onChange={e=>setXray(e.target.value as typeof xray)}><option value="discuss">Discuss with dentist</option><option value="yes">I am open to X-rays</option><option value="no">I prefer no X-rays</option></select></label></div>
          {selectedType?.intake_guidance&&<div className="callout">{selectedType.intake_guidance}</div>}
          {!selectedType?.immediate_booking&&<div className="callout">This visit needs staff review before online booking can be offered. Please call the practice.</div>}
          <button className="primary" onClick={search} disabled={busy||!selectedType?.immediate_booking||!selectedPatient}>Search next seven days</button>
          <div className="slot-list" aria-live="polite">{slots.length>0&&<><h3>Available times</h3><p className="muted">Showing {slots.length} options in Pacific time.</p><div className="slots">{slots.map((s,i)=><button key={`${s.startsAt}-${s.hygienistId}-${s.dentistId}-${s.operatoryId}-${i}`} onClick={()=>choose(s)} disabled={busy}>
            <b>{dateLabel(s.startsAt)} · {timeLabel(s.startsAt)}</b><span>{[s.hygienistId,s.dentistId].filter(Boolean).map(providerName).join(' + ')}</span></button>)}</div></>}</div>
        </section><aside className="side-stack"><section className="panel"><span className="eyebrow">BOOKING STATUS</span><h2>{intent?'Pending selection':'Ready when you are'}</h2>
          {intent?<><p>Your selection expires at {timeLabel(intent.expiresAt)}. It is not reserved in the practice system yet.</p><button className="primary" onClick={confirm} disabled={busy}>Confirm appointment</button></>:<p>Pick a candidate time to review and confirm it.</p>}</section>
          <section className="panel"><span className="eyebrow">COST & COVERAGE</span><h2>Still being checked</h2><p>No benefits check is available in this demo. We cannot estimate your out of pocket cost yet.</p></section></aside></div>}
        {tab==='admin'&&(session.actor.role==='admin'||session.actor.role==='staff')&&catalog&&<AdminWorkspace actor={session.actor} catalog={catalog} action={action} busy={busy} />}
        {tab==='dentist'&&session.actor.role==='dentist'&&<DentistWorkspace action={action} busy={busy} />}
      </>}
      {notice&&<div className="toast success" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}>×</button></div>}
      {error&&<div className="toast error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
    </main><footer className="footer">Independent concept · Fictional practice · Synthetic data only · Pacific time</footer>
  </div>;
}

type DentistPlan = {id:string;title:string;patientName:string;visits:{id:string;sequence:number;description:string;setting:{duration_minutes:number;scheduling_notes:string|null}|null}[]};
function DentistWorkspace({action,busy}:{action:(fn:()=>Promise<void>)=>Promise<void>;busy:boolean}) {
  const [plans,setPlans]=useState<DentistPlan[]>([]);
  const [durations,setDurations]=useState<Record<string,string>>({});
  const [notes,setNotes]=useState<Record<string,string>>({});
  const load=useCallback(async()=>{
    const result=await api<{plans:DentistPlan[]}>('/dentist/plans');setPlans(result.plans);
    const d:Record<string,string>={},n:Record<string,string>={};
    for(const plan of result.plans) for(const visit of plan.visits) {
      d[visit.id]=visit.setting?.duration_minutes?.toString()??'';
      n[visit.id]=visit.setting?.scheduling_notes??'';
    }
    setDurations(d);setNotes(n);
  },[]);
  useEffect(()=>{load().catch(()=>{});},[load]);
  async function save(visitId:string) {
    await action(async()=>{await post('/dentist/duration',{visitId,durationMinutes:Number(durations[visitId]),schedulingNotes:notes[visitId]||null});await load();});
  }
  return <div className="two-columns"><section className="panel"><span className="eyebrow">DENTIST WORKSPACE</span><h2>Treatment duration settings</h2><p>Approve the time needed for each visit. Scheduling still goes through staff review until visit rules and estimates are validated.</p>
    {plans.length?plans.map(plan=><article className="plan-card" key={plan.id}><h3>{plan.title}</h3><p>Patient: {plan.patientName}</p>{plan.visits.map(visit=><div className="dentist-visit" key={visit.id}><b>Visit {visit.sequence}: {visit.description}</b><div className="form-grid"><label>Approved minutes<input type="number" min="15" max="480" step="15" value={durations[visit.id]??''} onChange={e=>setDurations({...durations,[visit.id]:e.target.value})}/></label><label>Scheduling notes<input value={notes[visit.id]??''} onChange={e=>setNotes({...notes,[visit.id]:e.target.value})} maxLength={1000}/></label></div><button disabled={busy||!durations[visit.id]} onClick={()=>save(visit.id)}>Save duration</button></div>)}</article>):<p>No treatment plans assigned.</p>}</section>
    <aside className="panel"><span className="eyebrow">CLINICAL REVIEW</span><h2>Your decision guides the schedule</h2><p>Duration recommendations from completed visits are planned for a later release. No automatic treatment booking is active.</p></aside></div>;
}

function AdminWorkspace({actor,catalog,action,busy}:{actor:Actor;catalog:Catalog;action:(fn:()=>Promise<void>)=>Promise<void>;busy:boolean}) {
  const [monthOffset,setMonthOffset]=useState(0);
  const [calendar,setCalendar]=useState<{hours:{provider_id:string;weekday:number;start_local:string;end_local:string}[];exceptions:{provider_id:string;local_date:string;available:boolean}[]}|null>(null);
  const [selectedProvider,setSelectedProvider]=useState(catalog.providers[0]?.id??'');
  const [days,setDays]=useState<number[]>([1,2,3,4,5]);
  const [start,setStart]=useState('09:00');const [end,setEnd]=useState('17:00');
  const [report,setReport]=useState<{metrics:{id:string;name:string;count:number;average:string|null}[];comments:{id:string;appointment_id:string;provider_id:string;stars:number;comment:string|null}[]}|null>(null);
  const [tasks,setTasks]=useState<{id:string;kind:string;summary:string;target_id:string|null;created_at:string}[]>([]);
  const [grants,setGrants]=useState<{id:string;patientName:string;account_name:string;scope:string[];revoked_at:string|null}[]>([]);
  const month=monthString(monthOffset);
  const load=useCallback(async()=>{
    const [cal,review]=await Promise.all([api<typeof calendar>(`/admin/calendar?month=${month}`),api<{tasks:typeof tasks}>('/admin/review')]);
    setCalendar(cal);setTasks(review.tasks);
    if(actor.role==='admin') {
      const [feedback,guardian]=await Promise.all([api<typeof report>('/admin/feedback'),
        api<{grants:typeof grants}>('/admin/guardian-grants')]);
      setReport(feedback);setGrants(guardian.grants);
    }
  },[month,actor.role]);
  useEffect(()=>{load().catch(()=>{});},[load]);
  useEffect(()=>{if(!calendar)return;const h=calendar.hours.filter(h=>h.provider_id===selectedProvider);setDays(h.map(x=>Number(x.weekday)));
    setStart(h[0]?.start_local.slice(0,5)??'09:00');setEnd(h[0]?.end_local.slice(0,5)??'17:00');},[selectedProvider,calendar]);
  const first=new Date(`${month}-01T12:00:00Z`);const count=new Date(first.getUTCFullYear(),first.getUTCMonth()+1,0).getDate();
  const leading=first.getUTCDay();const cells=[...Array(leading).fill(null),...Array.from({length:count},(_,i)=>i+1)];
  function isAvailable(providerId:string,day:number) {
    const localDate=`${month}-${String(day).padStart(2,'0')}`;
    const override=calendar?.exceptions.find(x=>x.provider_id===providerId&&x.local_date===localDate);
    if(override) return override.available;
    const weekday=new Date(`${localDate}T12:00:00Z`).getUTCDay();
    return calendar?.hours.some(x=>x.provider_id===providerId&&Number(x.weekday)===weekday)??false;
  }
  async function toggle(day:number) {
    if(actor.role!=='admin'||!selectedProvider)return;
    const localDate=`${month}-${String(day).padStart(2,'0')}`;
    await action(async()=>{await post('/admin/exception',{providerId:selectedProvider,localDate,available:!isAvailable(selectedProvider,day),start,end});await load();});
  }
  async function saveHours() {await action(async()=>{await post('/admin/hours',{providerId:selectedProvider,weekdays:days,start,end});await load();});}
  return <div className="admin-grid"><section className="panel calendar-panel"><div className="section-heading"><div><span className="eyebrow">PROVIDER AVAILABILITY</span><h2>Monthly calendar</h2></div><div className="month-control"><button onClick={()=>setMonthOffset(Math.max(0,monthOffset-1))} aria-label="Previous month">‹</button><strong>{new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(first)}</strong><button onClick={()=>setMonthOffset(Math.min(5,monthOffset+1))} aria-label="Next month">›</button></div></div>
      <p className="muted">Select a provider, then click a date to switch that provider on or off. The calendar restricts local booking availability.</p>
      <div className="provider-legend">{catalog.providers.map(p=><button key={p.id} className={selectedProvider===p.id?'selected':''} onClick={()=>setSelectedProvider(p.id)}><span style={{background:p.color}}/>{p.name}</button>)}</div>
      <div className="calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><b className="weekday" key={d}>{d}</b>)}{cells.map((day,i)=>day?<button key={i} className="calendar-day" onClick={()=>toggle(day)} disabled={actor.role!=='admin'||busy||`${month}-${String(day).padStart(2,'0')}`<dayString()} aria-label={`${month}-${String(day).padStart(2,'0')} ${isAvailable(selectedProvider,day)?'available':'unavailable'} for selected provider`}>
        <span>{day}</span><div className="day-dots">{catalog.providers.filter(p=>isAvailable(p.id,day)).map(p=><i key={p.id} style={{background:p.color}} title={p.name}/>)}</div></button>:<span className="calendar-empty" key={i}/> )}</div>
    </section><aside className="side-stack"><section className="panel"><h2>Repeating workdays</h2><p className="muted">Set regular hours for the selected provider. Changes apply to future searches.</p><div className="weekday-checks">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><label key={d}><input type="checkbox" checked={days.includes(i)} disabled={actor.role!=='admin'} onChange={e=>setDays(e.target.checked?[...days,i]:days.filter(x=>x!==i))}/>{d}</label>)}</div>
      <div className="form-grid"><label>Start<input type="time" value={start} onChange={e=>setStart(e.target.value)} disabled={actor.role!=='admin'}/></label><label>End<input type="time" value={end} onChange={e=>setEnd(e.target.value)} disabled={actor.role!=='admin'}/></label></div><button onClick={saveHours} disabled={actor.role!=='admin'||busy}>Save repeating days</button></section>
      <section className="panel"><span className="eyebrow">NEEDS REVIEW</span><h2>Staff queue</h2>{tasks.length?tasks.map(t=><div className="task-row" key={t.id}><b>{t.kind.replace('_',' ')}</b><p>{t.summary}</p><small>{dateLabel(t.created_at)}</small>{t.kind==='record_request'&&<p><button disabled={busy} onClick={()=>action(async()=>{await post(`/admin/review/${t.id}/fulfill`,{});await load();})}>Mark fulfilled</button></p>}</div>):<p>No open review tasks.</p>}</section></aside>
    {actor.role==='admin'&&report&&<section className="panel report-panel"><span className="eyebrow">OWNER VIEW</span><h2>Provider feedback</h2><div className="metric-grid">{report.metrics.map(m=><div className="metric" key={m.id}><b>{m.average??'—'}</b><span>{m.name}</span><small>{m.count} rating{m.count===1?'':'s'}</small></div>)}</div><h3>Recent comments</h3>{report.comments.length?report.comments.map(c=><div className="feedback-item" key={c.id}><b>{'★'.repeat(c.stars)}</b><span>{catalog.providers.find(p=>p.id===c.provider_id)?.name} · appointment {c.appointment_id.slice(0,8)}</span>{c.comment&&<p>{c.comment}</p>}</div>):<p>No feedback has been submitted.</p>}</section>}
    {actor.role==='admin'&&<section className="panel report-panel"><span className="eyebrow">FAMILY ACCESS</span><h2>Guardian grants</h2><p>Access is granted per patient after staff verification. Shared contact details do not create access.</p>{grants.map(g=><div className="history-row" key={g.id}><div><b>{g.account_name} → {g.patientName}</b><small>{g.scope.join(', ')}</small></div>{g.revoked_at?<span className="status-pill">Revoked</span>:<button disabled={busy} onClick={()=>{if(window.confirm('Revoke this guardian grant?')) action(async()=>{await post(`/admin/guardian-grants/${g.id}/revoke`,{});await load();});}}>Revoke access</button>}</div>)}</section>}</div>;
}
