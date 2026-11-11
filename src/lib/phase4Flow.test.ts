import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { latestWrongIds, scoreAttempt } from '../App';
import { SUBJECTS } from '../constants';
import { selectPracticePool, selectPracticeBatch } from './bookSelection';
import { assignPracticeAnswer, checkPracticeAnswer } from './practiceFeedback';
import { getBookImage, getQuestions, getUserData, saveUserData } from './db';
import type { ActiveSession, Attempt, Question, UserData } from '../types';

// Synthetic isolated fixtures. These never enter a user's browser/database.
const bank: Question[] = SUBJECTS.legacy.flatMap((subject, s) => Array.from({length:45},(_,n)=>({
  id:`phase4-unit-s${s+1}-${n+1}`,year:2024,round:'검증용',originalSubject:subject,
  prompt:'실제 기출이 아닌 합성 회귀 검증용 지문',choices:['가','나','다','라'],answer:2,
  explanation:'합성 회귀 검증용 해설',status:'verified' as const,createdAt:'2026-10-12T00:00:00Z',
})));
const startedAt='2026-10-12T00:00:00Z';
function attempt(list:Question[],correctCount:number,overrides:Partial<Attempt>={}):Attempt {
  return {id:'phase4-unit-attempt',title:'합성 채점 검증',scheme:'legacy',mode:'subject',
    questionIds:list.map(q=>q.id),answers:Object.fromEntries(list.map((q,i)=>[q.id,i<correctCount?2:1])),
    startedAt,submittedAt:'2026-10-12T00:01:00Z',remainingSeconds:30,...overrides};
}

describe('Phase 4 grading and wrong-note regression',()=>{
  it('grades 18 of 20 as 90 without passing a practice batch as a formal exam',()=>{
    const result=scoreAttempt(attempt(bank.slice(0,20),18,{feedbackEnabled:true}),bank);
    expect(result).toMatchObject({correct:18,total:20,answered:20,score:90,fullExam:false,passed:false});
    expect(result.subjectScores).toMatchObject([{count:20,correct:18,score:90}]);
  });
  it('scores unanswered questions as zero while preserving the stored answer map',()=>{
    const entry=attempt(bank.slice(0,20),20); entry.answers={[bank[0].id]:2};
    expect(scoreAttempt(entry,bank)).toMatchObject({correct:1,answered:1,total:20,score:5});
    expect(Object.keys(entry.answers)).toEqual([bank[0].id]);
  });
  it('uses exact 60 average and 40 per subject at the official pass boundary',()=>{
    const list=SUBJECTS.legacy.flatMap(subject=>bank.filter(q=>q.originalSubject===subject).slice(0,20));
    const entry=attempt(list,0,{mode:'random',feedbackEnabled:false});
    for(let s=0;s<6;s++) for(let n=0;n<(s===0?8:s===1?16:12);n++) entry.answers[list[s*20+n].id]=2;
    expect(scoreAttempt(entry,bank)).toMatchObject({correct:72,score:60,fullExam:true,passed:true});
    entry.answers[list[7].id]=1;
    expect(scoreAttempt(entry,bank)).toMatchObject({fullExam:true,passed:false});
  });
  it('does not apply formal pass criteria to book-round practice or immediate-feedback sessions',()=>{
    const list=SUBJECTS.legacy.flatMap(subject=>bank.filter(q=>q.originalSubject===subject).slice(0,20));
    expect(scoreAttempt(attempt(list,120,{mode:'book-round',feedbackEnabled:false}),bank).fullExam).toBe(false);
    expect(scoreAttempt(attempt(list,120,{feedbackEnabled:true}),bank).fullExam).toBe(false);
  });
  it('uses the latest submitted response when removing a corrected wrong answer',()=>{
    const old=attempt(bank.slice(0,2),0,{id:'old',submittedAt:'2026-10-11T00:00:00Z'});
    const newer=attempt(bank.slice(0,1),1,{id:'new'});
    expect(latestWrongIds([newer,old],bank)).toEqual([bank[1].id]);
    expect(latestWrongIds([old,newer],bank)).toEqual([bank[1].id]);
    expect(old.answers[bank[0].id]).toBe(1);
  });
});

describe('Phase 4 existing version 4 learning flow',()=>{
  const original:UserData={key:'state',attempts:[attempt([bank[44]],1,{id:'existing'})],bookmarks:[bank[44].id],theme:'dark'};
  beforeAll(async()=>{
    const request=indexedDB.open('industrial-safety-cbt',4);
    request.onupgradeneeded=()=>{for(const [name,keyPath] of [['questionBank','id'],['userData','key'],['pdfSources','id'],['pdfFiles','id'],['pdfDrafts','id'],['pdfPageTexts','id'],['bookImages','id'],['bookImports','importId']]) request.result.createObjectStore(name,{keyPath});};
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const tx=database.transaction(['questionBank','userData','bookImages','pdfSources'],'readwrite');
    bank.forEach(q=>tx.objectStore('questionBank').put(q));
    tx.objectStore('userData').put(original);
    tx.objectStore('bookImages').put({id:'phase4-preserved-image',kind:'review',blob:new Blob(['isolated image fixture']),createdAt:startedAt});
    tx.objectStore('pdfSources').put({id:'phase4-preserved-pdf',name:'synthetic fixture'});
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}); database.close();
  });
  it('partitions a subject into 20/20/5 unique questions and preserves all source ids',async()=>{
    const stored=await getQuestions();
    const pool=selectPracticePool(stored,{scheme:'legacy',mode:'subject',subject:SUBJECTS.legacy[0]});
    const batches=[0,1,2].map(n=>selectPracticeBatch(pool,n));
    expect(batches.map(b=>b.length)).toEqual([20,20,5]);
    expect(new Set(batches.flat().map(q=>q.id)).size).toBe(45);
    expect(batches.flat().every(q=>q.originalSubject===SUBJECTS.legacy[0])).toBe(true);
    expect(await getQuestions()).toEqual(stored);
  });
  it('round-trips checked answers, navigation, marks and bookmarks while retaining history, questions and images',async()=>{
    const before=await getQuestions(); const previous=await getUserData();
    let session:ActiveSession={id:'phase4-unit-session',title:'합성 20문항 검증',scheme:'legacy',mode:'subject',questionIds:bank.slice(0,20).map(q=>q.id),answers:{},markedIds:[bank[0].id],index:0,startedAt,deadlineAt:Date.now()+1200000,feedbackEnabled:true};
    session=assignPracticeAnswer(session,bank[0].id,1); session=checkPracticeAnswer(session,bank[0]);
    session={...session,index:1};
    await saveUserData({...previous,activeSession:session,bookmarks:[...previous.bookmarks,bank[0].id]});
    const restored=await getUserData();
    expect(restored.activeSession).toEqual(session);
    expect(assignPracticeAnswer(restored.activeSession!,bank[0].id,2).answers[bank[0].id]).toBe(1);
    expect(restored.attempts).toEqual(original.attempts);
    expect(restored.bookmarks).toEqual([bank[44].id,bank[0].id]);
    expect(await getQuestions()).toEqual(before);
    expect((await getBookImage('phase4-preserved-image'))?.blob.size).toBeGreaterThan(0);
    expect((await indexedDB.databases()).find(d=>d.name==='industrial-safety-cbt')?.version).toBe(4);
  });
});
