'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveTurn, claimsUngroundedChart, asksPrepPrerequisite, repeatsPrior, inventedChartTerms } = require('../app/turn.js');
const { qualityReasons, classifyStream, readStream, tokenBudget } = require('./local-model.cjs');
const { createStore } = require('./store.cjs');
const { systemPrompt } = require('./prompts.cjs');

const exam = '下个月我会参加英语六级考试。我通过的概率大吗？';
const angle = '仅从算命的角度回答。';
const first = resolveTurn({ text: exam, history: [], hasSnapshot: false });
const second = resolveTurn({
  text: angle,
  history: [
    { speaker: 'user', content: exam },
    { speaker: 'zhiji', content: '知几看了一圈你的盘面，目前的信息里只有下个月考六级这个目标，但关于你现在的准备进度、之前的英语成绩、复习投入时长，以及是否有人带你备考这些关键事实都没有。' }
  ],
  hasSnapshot: true
});
const secondFresh = resolveTurn({
  text: angle,
  history: [{ speaker: 'user', content: exam }],
  hasSnapshot: false
});
const kaoyan = resolveTurn({
  text: '明年我想考研，通过的概率大吗？',
  history: [{ speaker: 'user', content: exam }],
  hasSnapshot: true
});
const hello = resolveTurn({ text: '你好', history: [], hasSnapshot: false });
const offer = resolveTurn({ text: '拿到一个异地 offer，要不要去？', history: [], hasSnapshot: false });
const preference = resolveTurn({
  text: '我最在意能不能照顾家人',
  history: [{ speaker: 'user', content: '拿到一个异地 offer，要不要去？' }],
  hasSnapshot: false
});
const weather = resolveTurn({
  text: '今天天气真好',
  history: [{ speaker: 'user', content: exam }],
  hasSnapshot: true
});
const fortuneAsk = resolveTurn({ text: '你好，我要算命', history: [], hasSnapshot: false });
const yearLook = resolveTurn({ text: '看今年整体', history: [{ speaker: 'user', content: '你好，我要算命' }], hasSnapshot: false });
const fortuneAgain = resolveTurn({
  text: '仅从命理角度再说',
  history: [{ speaker: 'user', content: exam }],
  hasSnapshot: true
});

const checks = [
  ['first casts', first.plan === 'cast' && first.task === 'read' && first.matter.event === '英语六级' && first.matter.timeWindow === '下个月' && first.matter.ask === '能否通过' && first.matter.domain === 'study'],
  ['first chart text', first.chartText === exam],
  ['second revises same exam', second.plan === 'reuse' && second.task === 'revise' && second.angle === 'fortune' && second.matter.event === '英语六级' && second.matter.timeWindow === '下个月' && second.chartText === exam],
  ['second without snapshot still casts the exam', secondFresh.plan === 'cast' && secondFresh.chartText === exam && secondFresh.task === 'revise'],
  ['new exam casts again', kaoyan.plan === 'cast' && kaoyan.matter.event === '考研' && kaoyan.matter.timeWindow === '明年' && kaoyan.chartText.includes('考研')],
  ['greeting stays chat', hello.plan === 'none' && hello.task === 'chat'],
  ['open choice asks once', offer.plan === 'none' && offer.task === 'ask'],
  ['stated preference then casts the choice', preference.plan === 'cast' && preference.task === 'read' && preference.chartText.includes('offer')],
  ['aside does not inherit the chart', weather.plan === 'none' && weather.task === 'chat'],
  ['bare fortune ask does not cast', fortuneAsk.plan === 'none' && fortuneAsk.task === 'offer'],
  ['year overview casts a year, not a bare chart', yearLook.plan === 'cast' && yearLook.task === 'read' && yearLook.matter.event === '这一年的整体走势' && yearLook.matter.timeWindow === '今年'],
  ['fortune angle still revises the exam', fortuneAgain.plan === 'reuse' && fortuneAgain.task === 'revise' && fortuneAgain.matter.event === '英语六级'],
  ['claim detector', claimsUngroundedChart('知几看了一圈你的盘面，目前的信息里只有下个月考六级这个目标。')],
  ['prep detector', asksPrepPrerequisite('你最近一个月平均每天花了多少时间在英语上？')],
  ['repeat detector', repeatsPrior('知几看了一圈你的盘面，目前的信息里只有下个月考六级这个目标，但关于你现在的准备进度、之前的英语成绩、复习投入时长都没有。', '知几看了一圈你的盘面，目前的信息里只有下个月考六级这个目标，但关于你现在的准备进度、之前的英语成绩、复习投入时长都没有。')],
  ['distinct answers are not repeats', !repeatsPrior('只从这次盘看，准备过程偏有利，临场还有牵制，所以还不到稳过。依据见文昌所在的宫。', '奇门按问事时刻起局，景门这一路有阻力，考试日和起局日不是同一天。')]
];

const prompt = systemPrompt({
  roleId: 'ziwei',
  task: 'read',
  angle: 'fortune',
  matter: first.matter,
  timeMode: 'unknown'
});
checks.push(['ziwei names itself', prompt.includes('自称紫微') && prompt.includes('不要自称知几') && !prompt.includes('对用户自称知几')]);
checks.push(['exam prompt skips marriage rules', prompt.includes('英语六级') && !prompt.includes('婚恋')]);
checks.push(['fortune angle stops prep questions', prompt.includes('不要追问复习时长')]);

const long = '知几看了一圈你的盘面，目前的信息里只有下个月考六级这个目标，但关于你现在的准备进度、之前的英语成绩、复习投入时长都没有，所以没法判断。';
const grounded = qualityReasons(long, {
  task: 'revise',
  angle: 'fortune',
  matter: { domain: 'study' },
  previousAnswer: long,
  evidence: [{ id: 'E1', fact: '景门' }]
});
const ungrounded = qualityReasons('知几看了一圈你的盘面，可是这一轮并没有把盘送进来，所以这句话不该出现。', {
  task: 'chat',
  angle: '',
  matter: null,
  previousAnswer: '',
  evidence: []
});
checks.push(['quality flags repeat, prep and missing cite', ['repeat', 'prep', 'cite'].every((item) => grounded.includes(item)) && !grounded.includes('claim')]);
checks.push(['ungrounded chart claim is flagged', ungrounded.includes('claim')]);
const sampleEvidence = [
  { id: 'E2', label: '奇门 · 景门（离9宫）', fact: '九星 天英；八神 白虎；天盘 庚；地盘 庚' },
  { id: 'E4', label: '奇门 · 值符 天蓬', fact: '值符落 1 宫。' },
  { id: 'E5', label: '奇门 · 值使 休门', fact: '值使落 1 宫。' }
];
const invented = inventedChartTerms('值使落震三宫。', sampleEvidence);
checks.push(['rejects a palace the snapshot does not have', invented.includes('3宫')]);
checks.push(['keeps the geng pair written on the snapshot', inventedChartTerms('景门逢天英，也就是庚加庚。', sampleEvidence).length === 0]);
checks.push(['does not treat a missing example as a claim', inventedChartTerms('因为时辰不详，没有化科。', sampleEvidence).length === 0]);
checks.push(['rejects putting 值符 in the gate palace', inventedChartTerms('值符同落离宫。', sampleEvidence).some((item) => item.includes('9'))]);
checks.push(['denying a numeric rate is not a fake percent', !require('../app/turn.js').inventsPercent('命盘无法给出一个确定的通过率')]);

const dbPath = path.join(os.tmpdir(), 'zhiji-turn-check-' + process.pid + '.sqlite');
const store = createStore(dbPath);
store.setIdentity({ nickname: '试', avatar: 'seal:bamboo' });
const user = store.appendMessage({ conversationId: 'conv-hall', speaker: 'user', content: exam });
const reply = store.appendMessage({
  conversationId: 'conv-hall',
  speaker: 'zhiji',
  content: '第一次回答。',
  replyTo: user.message.id,
  evidence: [{ id: 'E1', system: 'qimen', label: '景门', fact: '景门', stability: 'exact' }]
});
const again = store.appendMessage({
  conversationId: 'conv-hall',
  speaker: 'zhiji',
  content: '重试不该再落一条。',
  replyTo: user.message.id
});
const listed = store.listMessages('conv-hall').filter((item) => item.speaker === 'zhiji');
checks.push(['retry keeps one reply', again.duplicate === true && again.message.id === reply.message.id && listed.length === 1 && listed[0].replyTo === user.message.id]);
const kept = store.appendMessage({
  conversationId: 'conv-zhiji',
  speaker: 'zhiji',
  content: '由于',
  replyTo: user.message.id,
  delivery: { finish: 'interrupted', model: 'gemma', channel: 'local', usage: null }
});
const reopened = store.listMessages('conv-zhiji').find((item) => item.id === kept.message.id);
checks.push(['interrupted reply stays interrupted', reopened.delivery.finish === 'interrupted' && reopened.content === '由于']);
const both = [{ system: 'ziwei' }, { system: 'qimen' }];
checks.push(['local reading budget', tokenBudget('read', [{ system: 'ziwei' }]) === 1100]);
checks.push(['dual chart budget', tokenBudget('read', both) === 1800]);
checks.push(['length is not success', classifyStream({ text: '由于', finishReason: 'length' }).ok === false && classifyStream({ text: '由于', finishReason: 'length' }).code === 'length']);
checks.push(['drop is not success', classifyStream({ text: '由于', failed: 'interrupted' }).ok === false && classifyStream({ text: '由于', failed: 'interrupted' }).code === 'interrupted']);
checks.push(['stop is its own state', classifyStream({ text: '由于', failed: 'stopped' }).code === 'stopped']);
checks.push(['clean stop succeeds', classifyStream({ text: '说完了。', finishReason: 'stop' }).ok === true]);
store.close();
fs.rmSync(dbPath, { force: true });

async function verifyStreams() {
async function streamOf(parts, failAt) {
  let index = 0;
  return {
    body: {
      getReader() {
        return {
          async read() {
            if (failAt != null && index === failAt) throw new Error('dropped');
            if (index >= parts.length) return { done: true };
            const value = new TextEncoder().encode(parts[index]);
            index += 1;
            return { done: false, value };
          }
        };
      }
    }
  };
}
const lengthFrame = 'data: {"choices":[{"delta":{"content":"由于"},"finish_reason":"length"}]}\n\n';
const lengthRead = await readStream(await streamOf([lengthFrame]), () => {});
checks.push(['parser keeps length', lengthRead.ok === false && lengthRead.code === 'length' && lengthRead.text === '由于']);
const dropRead = await readStream(await streamOf(['data: {"choices":[{"delta":{"content":"由于"}}]}\n\n'], 1), () => {});
checks.push(['parser keeps the drop', dropRead.ok === false && dropRead.code === 'interrupted' && dropRead.text === '由于']);
}

verifyStreams().then(() => {
  const failed = checks.filter((item) => !item[1]);
  if (failed.length) {
    console.error(failed.map((item) => item[0]).join('\n'));
    process.exit(1);
  }
  console.log('TURN_OK ' + checks.length);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
