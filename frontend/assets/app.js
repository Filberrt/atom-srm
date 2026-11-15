(() => {
  function splitStatements(code){
    const out=[];let cur='',quote='',esc=false;
    for(const ch of String(code||'')){
      if(esc){cur+=ch;esc=false;continue}
      if(ch==='\\'){cur+=ch;esc=true;continue}
      if(quote){cur+=ch;if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;cur+=ch;continue}
      if(ch===';'){if(cur.trim())out.push(cur.trim());cur='';continue}
      cur+=ch;
    }
    if(cur.trim())out.push(cur.trim());
    return out;
  }

  function splitArgs(text){
    const out=[];let cur='',quote='',esc=false,depth=0;
    for(const ch of String(text||'')){
      if(esc){cur+=ch;esc=false;continue}
      if(ch==='\\'){cur+=ch;esc=true;continue}
      if(quote){cur+=ch;if(ch===quote)quote='';continue}
      if(ch==='"'||ch==="'"){quote=ch;cur+=ch;continue}
      if(ch==='('){depth++;cur+=ch;continue}
      if(ch===')'){depth--;cur+=ch;continue}
      if(ch===','&&depth===0){out.push(cur.trim());cur='';continue}
      cur+=ch;
    }
    if(cur.trim())out.push(cur.trim());
    return out;
  }

  function parseArg(raw,event,el){
    const value=String(raw||'').trim();
    if(value==='this')return el;
    if(value==='event')return event;
    if(value==='this.value')return el.value;
    if(value==='true')return true;
    if(value==='false')return false;
    if(value==='null')return null;
    if(/^[-]?\d+(\.\d+)?$/.test(value))return Number(value);
    const quoted=value.match(/^(['"])([\s\S]*)\1$/);
    if(quoted)return quoted[2].replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\');
    return value;
  }

  function callNamed(name,args){
    const target=String(name||'').split('.').reduce((ctx,key)=>ctx?.[key],window);
    if(typeof target!=='function')throw new Error('Unknown UI action: '+name);
    return target(...args);
  }

  function runUiAction(code,event,el){
    for(const statement of splitStatements(code)){
      if(statement==='event.stopPropagation()'){event.stopPropagation();continue}
      if(statement==="document.getElementById('importFile').click()"||statement==='document.getElementById("importFile").click()'){
        document.getElementById('importFile')?.click();
        continue;
      }
      const openMatch=statement.match(/^window\.open\((['"])([\s\S]*?)\1\s*,\s*(['"])([\s\S]*?)\3\)$/);
      if(openMatch){window.open(openMatch[2],openMatch[4]);continue}
      const syncAlert=statement.match(/^syncClientsToBackendNow\(\)\.then\(\(\)=>alert\((['"])([\s\S]*?)\1\)\)$/);
      if(syncAlert){
        Promise.resolve(window.syncClientsToBackendNow?.()).then(()=>alert(syncAlert[2])).catch((error)=>console.warn(error));
        continue;
      }
      const call=statement.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\(([\s\S]*)\)$/);
      if(call){
        const args=splitArgs(call[2]).map((arg)=>parseArg(arg,event,el));
        const result=callNamed(call[1],args);
        if(result&&typeof result.catch==='function')result.catch((error)=>console.warn(error));
        continue;
      }
      console.warn('Unhandled UI action:',statement);
    }
  }

  function delegate(type,attr){
    document.addEventListener(type,(event)=>{
      const el=event.target?.closest?.(`[${attr}]`);
      if(!el)return;
      runUiAction(el.getAttribute(attr),event,el);
    });
  }

  delegate('click','data-onclick');
  delegate('input','data-oninput');
  delegate('change','data-onchange');
})();

const CREDENTIALS={nikita:{pass:'',name:'Никита',city:'Уфа',role:'CRM / руководитель'},danila:{pass:'',name:'Данила',city:'Екатеринбург',role:'CRM / внедрение'},radik:{pass:'',name:'Радик',city:'Казань',role:'CRM / менеджер'}};
const CITIES=['Уфа','Екатеринбург','Казань'];
const SOURCES=['Telegram','2ГИС / Карты','Яндекс Карты','Сарафан','Instagram','Повторник'];
const CLIENT_CATEGORIES=['Криптообмен','Автомобили','Недвижимость','Цветы','Табак / уголь','Китай / импорт'];
const DEFAULT_TOUCH_DAYS=7;
const CITY_GUIDES={
  'Уфа':{msg:'Адрес офиса Уфа: [адрес офиса].\nКогда будете подъезжать, напишите менеджеру. Встречаем по предварительному фиксу.'},
  'Екатеринбург':{msg:'Адрес офиса Екатеринбург: [адрес офиса].\nПеред визитом напишите менеджеру, чтобы подготовили кассу и окно.'},
  'Казань':{msg:'Адрес офиса Казань: [адрес офиса].\nПодъезжайте только после подтверждения курса, суммы и времени.'}
};
const LOSS_REASONS={expensive:{label:'Дорого / курс не подходит',days:2,said:['Курс не подходит','Большая разница по курсу','Комиссия не устраивает','Другое'],actions:['Написать при улучшении курса','Предложить зафиксировать при подходящем курсе','Уточнить критичную разницу']},competitor:{label:'Ушёл к конкуренту',days:2,said:['Нашёл выгоднее','Уже договорился','Сравнивает варианты','Другое'],actions:['Проверить, выдали ли сумму','Предупредить про финальные условия','Написать через 2 дня']},trust:{label:'Нет доверия',days:1,said:['Боится перевода','Сомневается в офисе','Просит гарантии','Другое'],actions:['Отправить отзывы и адрес офиса','Предложить звонок с менеджером','Провести через безопасность']},thinking:{label:'Думает',days:1,said:['Подумает','Нужно посоветоваться','Вернётся позже','Другое'],actions:['Мягко напомнить сегодня','Написать завтра','Предложить фикс']},nomoney:{label:'Не готов по сумме',days:5,said:['Нет всей суммы','Перенёс дату','Ждёт поступление','Другое'],actions:['Поставить дату касания','Уточнить новую дату','Напомнить за день']},other:{label:'Другое',days:2,said:['Другое'],actions:['Ручное действие','Написать через 2 дня','Передать руководителю']}};
const DEAL_SOP_STEPS=[
{title:'Первый контакт',tag:'старт',desc:'Создать сделку сразу после первого сообщения клиента.',msg:c=>`Здравствуйте! Подскажите, пожалуйста:\n— город\n— сумму\n— что хотите сделать: купить USDT или продать USDT?`},
{title:'Уточнить город / сумму / направление',tag:'3 поля',desc:'Без этого нельзя считать курс.',msg:c=>`Зафиксировал: ${c.city}, ${c.amount?c.amount.toLocaleString('ru')+' ₽':'сумма уточняется'}, ${c.direction==='sell'?'USDT → рубли':'рубли → USDT'}.`},
{title:'Запросить курс у команды',tag:'курс',desc:'Город / сумма / направление одной строкой.',msg:c=>`Коллеги, курс ${c.city}\n${c.amount?c.amount.toLocaleString('ru')+' ₽':'сумма ?'}\n${c.direction==='sell'?'Нам тез, мы рубли':'Нам рубли, мы тез'}`},
{title:'Проверить кассу',tag:'касса',desc:'Для выдачи рублей: проверить, есть ли нужная сумма в кассе или гарантированно будет.',msg:c=>`Коллеги, по ${c.city} проверьте кассу на выдачу ${c.amount?c.amount.toLocaleString('ru')+' ₽':'[сумма]'} в [время]. Сможем провести?`},
{title:'Согласовать время с офисом',tag:'время',desc:'Уточнить у менеджера города возможность принять клиента.',msg:c=>`${c.city}, сможете принять клиента в [время]? Сумма: ${c.amount?c.amount.toLocaleString('ru')+' ₽':'[сумма]'}.`},
{title:'Озвучить курс клиенту',tag:'клиент',desc:'После подтверждения курса, кассы и времени.',msg:c=>`По вашей сумме можем провести. Курс: [курс].\nСумма к выдаче/получению: [сумма].\nВремя визита: [время]. Подходит?`},
{title:'Фикс в командный чат',tag:'фикс',desc:'Фикс только после подтверждения кассы и времени.',msg:c=>`Фикс ${c.city}\nКлиент: ${c.name}\n${c.amount?c.amount.toLocaleString('ru')+' ₽':'[сумма]'}\nКурс клиенту: [курс]\nВремя: [время]`},
{title:'Адрес и проходка',tag:'офис',desc:'Отправить адрес и проходку по городу.',msg:c=>CITY_GUIDES[c.city]?.msg||'Адрес: [адрес]\nКак будете подъезжать — напишите.'},
{title:'Кошелёк / приём средств',tag:'TRC20',desc:'Для USDT: отправить кошелёк, проверить сеть TRC20.',msg:c=>`Кошелёк TRC20:\n[адрес]\n\nПроверьте, пожалуйста, сеть TRC20 перед отправкой.`},
{title:'Завершение',tag:'архив',desc:'Клиент получил деньги / USDT. Закрыть сделку.',msg:c=>`Сделка завершена. Спасибо за доверие — будем рады видеть вас снова в Атом.`}
];
let clients=JSON.parse(localStorage.getItem('atom_v7_clients')||'null');let profile=JSON.parse(localStorage.getItem('atom_v7_profile')||'null');let integrations=JSON.parse(localStorage.getItem('atom_v7_integrations')||'null')||{telegram:{account:'',mode:'needed',chats:[]},google:{sheetId:'',webAppUrl:'',lastSync:'',lastPayload:''}};let activeClientId=null,calcDir='buy',calcInputMode='rub',timer=null;
function gid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}function today(){return new Date().toISOString().split('T')[0]}function fmt(n){return Number(n||0).toLocaleString('ru')}function save(){localStorage.setItem('atom_v7_clients',JSON.stringify(clients))}function saveProfile(){localStorage.setItem('atom_v7_profile',JSON.stringify(profile))}function saveIntegrations(){localStorage.setItem('atom_v7_integrations',JSON.stringify(integrations))}function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function nextTouchDate(days=DEFAULT_TOUCH_DAYS){return new Date(Date.now()+Number(days||DEFAULT_TOUCH_DAYS)*86400000).toISOString().split('T')[0]}function normalizeClient(c){if(!CITIES.includes(c.city))c.city='Уфа';c.category=c.category||CLIENT_CATEGORIES[0];c.touchFrequency=Number(c.touchFrequency||DEFAULT_TOUCH_DAYS);c.nextTouchDate=c.nextTouchDate||c.followUpDate||nextTouchDate(c.touchFrequency);c.assignedTo=c.assignedTo||profile?.login||'nikita';c.touches=c.touches||[];c.telegramMessages=c.telegramMessages||[];c.telegramChat=c.telegramChat||{title:c.name,username:c.username||'',chatId:'',status:c.source==='Telegram'?'linked':'not_linked'};return c}function normalizeAll(){clients=(clients||[]).map(normalizeClient);save()}
function seedClients(){const names=['Мария','Иван','Алина','Рустам','Дмитрий','Олег','Сергей','Ксения','Тимур','Николай','Диана','Пётр','Виктор','Яна','Андрей','Алёна','Руслан','Эльвина','Надежда','Максим','Кристина','Rail','Alexander','Светлана','Радик','Элина','Вика','Ольга','Никита','Данила','Артём','Денис','Ян','Алексей','Марат','Полина','Илья','Егор','Анна','Влад'];const arr=[];for(let i=0;i<40;i++){let stage=i<13?'active':i<22?'losing':i<33?'done':'lost';let amt=[80000,150000,230000,320000,500000,750000,1200000][i%7];let dir=i%2?'sell':'buy';let sop=Array(10).fill(false).map((_,j)=>stage==='done'||(stage==='active'&&j<(i%7+1))||(stage==='losing'&&j<(i%5+2)));arr.push({id:gid(),name:names[i],phone:'+7 9'+String(100000000+i*13729).slice(0,9),username:'@client_'+(i+1),city:CITIES[i%CITIES.length],source:SOURCES[i%SOURCES.length],amount:amt,direction:dir,stage,createdAt:new Date(Date.now()-(i*3600000)).toISOString(),closedAt:['done','lost'].includes(stage)?new Date(Date.now()-(i*8600000)).toISOString():'',comment:'Демо-контекст клиента',lossReason:stage==='lost'||stage==='losing'?['expensive','competitor','trust','thinking','nomoney'][i%5]:'',clientSaid:stage==='lost'||stage==='losing'?['Курс не подходит','Нашёл выгоднее','Нет доверия','Подумает','Перенёс дату'][i%5]:'',lossAction:stage==='lost'||stage==='losing'?['Написать при улучшении курса','Проверить, выдали ли сумму','Отправить отзывы','Мягко напомнить','Уточнить новую дату'][i%5]:'',followUpDate:stage==='lost'||stage==='losing'?new Date(Date.now()+((i%5)+1)*86400000).toISOString().split('T')[0]:'',deals:[{id:gid(),createdAt:new Date(Date.now()-(i*3600000)).toISOString(),amount:amt,stage,sop,closedAt:['done','lost'].includes(stage)?new Date(Date.now()-(i*8600000)).toISOString():''}],calcData:{rate:82+(i%6),spread:[.1,.15,.2,.25,.3][i%5],amount:amt,fee:amt<250000},category:CLIENT_CATEGORIES[i%CLIENT_CATEGORIES.length],touchFrequency:[7,14,30][i%3],nextTouchDate:new Date(Date.now()+((i%7)+1)*86400000).toISOString().split('T')[0],assignedTo:['nikita','danila','radik'][i%3],touches:[],telegramChat:{title:'Чат '+names[i],username:'@client_'+(i+1),status:'linked'}})}return arr}
function authStep1(){const l=document.getElementById('auth-login').value.trim().toLowerCase(),p=document.getElementById('auth-pass').value,e=document.getElementById('auth-err-1');if(!CREDENTIALS[l]||CREDENTIALS[l].pass!==p){e.style.display='block';return}e.style.display='none';profile={name:CREDENTIALS[l].name,city:CREDENTIALS[l].city,login:l,role:CREDENTIALS[l].role};document.getElementById('auth-step-1').classList.remove('active');document.getElementById('auth-step-2').classList.add('active');buildTOTP();}
function buildTOTP(){const w=document.getElementById('totp-inputs');w.innerHTML='';for(let i=0;i<6;i++){const inp=document.createElement('input');inp.className='totp-digit';inp.maxLength=1;inp.inputMode='numeric';inp.oninput=()=>{inp.value=inp.value.replace(/\D/g,'');if(inp.value&&i<5)w.children[i+1].focus()};w.appendChild(inp)}w.children[0].focus()}
function authStep2(){const code=[...document.getElementById('totp-inputs').children].map(i=>i.value).join(''),e=document.getElementById('auth-err-2');if(!/^\d{6}$/.test(code)){e.style.display='block';return}e.style.display='none';if(!clients)clients=seedClients();normalizeAll();save();saveProfile();bootApp()}
function backToStep1(){document.getElementById('auth-step-2').classList.remove('active');document.getElementById('auth-step-1').classList.add('active')}function logout(){document.getElementById('app').classList.remove('visible');document.getElementById('auth-screen').style.display='flex'}
function bootApp(){if(!clients)clients=seedClients();normalizeAll();document.getElementById('auth-screen').style.display='none';document.getElementById('app').classList.add('visible');applyProfile();renderCRM();renderArchive();renderCabinet();clearInterval(timer);timer=setInterval(()=>{renderCRM(false)},30000)}
function applyProfile(){document.getElementById('sb-name').textContent=profile?.name||'Менеджер';document.getElementById('sb-city').textContent=profile?.city||'Уфа';document.getElementById('sb-avatar').textContent=(profile?.name||'М')[0].toUpperCase()}function openProfileEdit(){const n=prompt('Ваше имя:',profile?.name||'');if(n){profile.name=n;saveProfile();applyProfile();renderCabinet()}}
function showPage(id,el){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.sb-item').forEach(n=>n.classList.remove('active'));document.getElementById('page-'+id).classList.add('active');el.classList.add('active');document.getElementById('topbar-title').textContent={crm:'CRM — Live сделки',archive:'Архив',cabinet:'Личный кабинет'}[id];if(id==='crm')renderCRM();if(id==='archive')renderArchive();if(id==='cabinet')renderCabinet();}
function progress(c){const d=c.deals?.at(-1);const sop=d?.sop||[];const done=sop.filter(Boolean).length,total=DEAL_SOP_STEPS.length;return{done,total,pct:Math.round(done/total*100)}}function ageMin(c){return Math.floor((Date.now()-new Date(c.createdAt).getTime())/60000)}function ageLabel(c){const m=ageMin(c);return m<60?m+' мин':Math.floor(m/60)+' ч '+(m%60)+' мин'}function activeList(){return clients.filter(c=>c.stage==='active')}function touchDueList(){return clients.filter(c=>c.stage==='active'&&c.nextTouchDate&&c.nextTouchDate<=today())}function losingList(){return clients.filter(c=>c.stage==='losing')}function archivedList(){return clients.filter(c=>c.stage==='done'||c.stage==='lost')}
function metric(label,val,sub,pct){return`<div class="metric-card compact"><div class="mc-label">${label}</div><div class="mc-value ${String(val).includes('M')?'g':''}">${val}</div><div class="mc-sub">${sub}</div><div class="metric-line"><span style="width:${pct}%"></span></div></div>`}function kpi(label,val,note,pct){return`<div class="kpi-card"><div class="kpi-top"><div class="kpi-label">${label}</div><div class="kpi-value g">${val}</div></div><div class="bar-fill-ui"><span style="width:${pct}%"></span></div><div class="kpi-note">${note}</div></div>`}
function openNC(){document.getElementById('nc-form').classList.add('open');const nt=document.getElementById('nc-next-touch');if(nt&&!nt.value)nt.value=nextTouchDate(DEFAULT_TOUCH_DAYS)}function closeNC(){document.getElementById('nc-form').classList.remove('open')}function createClient(){const name=document.getElementById('nc-name').value.trim();if(!name){alert('Введи имя');return}const amt=+document.getElementById('nc-amount').value||0,tf=+document.getElementById('nc-touch-frequency').value||DEFAULT_TOUCH_DAYS;const c=normalizeClient({id:gid(),name,phone:document.getElementById('nc-phone').value.trim(),username:document.getElementById('nc-username').value.trim(),city:document.getElementById('nc-city').value,amount:amt,direction:document.getElementById('nc-dir').value,source:document.getElementById('nc-source').value,category:document.getElementById('nc-category').value,touchFrequency:tf,nextTouchDate:document.getElementById('nc-next-touch').value||nextTouchDate(tf),assignedTo:profile?.login||'nikita',comment:document.getElementById('nc-comment').value.trim(),stage:'active',createdAt:new Date().toISOString(),deals:[{id:gid(),createdAt:new Date().toISOString(),amount:amt,stage:'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)}],calcData:{rate:82,spread:.2,amount:amt,fee:amt<250000}});clients.unshift(c);save();closeNC();renderCRM();renderCabinet();openClient(c.id)}
function renderCRM(){const board=document.getElementById('crm-board');if(!board)return;normalizeAll();const q=(document.getElementById('crm-search')?.value||'').toLowerCase(),city=document.getElementById('filter-city')?.value||'';const filt=c=>(!city||c.city===city)&&(!q||[c.name,c.phone,c.username,c.city,c.source,c.category,c.assignedTo].join(' ').toLowerCase().includes(q));const dueIds=new Set(touchDueList().map(c=>c.id));const active=activeList().filter(c=>!dueIds.has(c.id)).filter(filt).sort((a,b)=>ageMin(b)-ageMin(a)),touch=touchDueList().filter(filt).sort((a,b)=>(a.nextTouchDate||'').localeCompare(b.nextTouchDate||'')),losing=losingList().filter(filt).sort((a,b)=>(a.followUpDate||'').localeCompare(b.followUpDate||'')),done=clients.filter(c=>c.stage==='done').filter(filt).slice(0,12);const liveRub=activeList().reduce((s,c)=>s+c.amount,0);document.getElementById('live-money-box').innerHTML=`<div class="live-money-main">${fmt(liveRub)} ₽</div><div class="live-money-sub">В работе сейчас · ${activeList().length} активных · ${touch.length} ждут касания · ${losing.length} на дожиме</div>`;board.innerHTML=`${col('В работе',active)}${col('Касания',touch,true)}${col('Клиент сливается / задачи',losing,true)}${col('Завершено',done)}`;const badge=document.getElementById('remind-badge');const reminders=touch.length+losing.length;if(reminders){badge.style.display='';badge.textContent=reminders}else badge.style.display='none'}function col(title,list,losing=false){return`<div class="live-col"><div class="live-col-head"><div class="live-col-title">${title}</div><div class="live-count">${list.length}</div></div>${list.map(c=>dealCard(c,losing)).join('')||'<div class="empty-col">Пусто</div>'}</div>`}function dealCard(c,losing=false){const p=progress(c),m=ageMin(c),timeCls=m>60?'danger':m>30?'warn':'';return`<div class="deal-card ${losing?'losing':''}" data-client-id="${esc(c.id)}" style="--p:${p.pct}%" data-onclick="openClient('${c.id}')"><div class="deal-top"><div><div class="deal-name">${esc(c.name)}</div><div class="deal-amt">${c.amount?fmt(c.amount)+' ₽':'сумма не указана'}</div><div class="contact-mini">${c.phone?`<span class="contact-pill">${esc(c.phone)}</span>`:''}${c.username?`<span class="contact-pill">${esc(c.username)}</span>`:''}</div></div><div class="deal-time ${timeCls}">${losing?(c.followUpDate||'задача'):ageLabel(c)}</div></div><div class="deal-meta"><span class="deal-pill">${c.city}</span><span class="deal-pill">${esc(c.category||'Криптообмен')}</span><span class="deal-pill">${c.direction==='sell'?'выдаём ₽':'выдаём USDT'}</span><span class="deal-pill">${p.done}/${p.total}</span>${c.lossReason?`<span class="deal-pill red">${LOSS_REASONS[c.lossReason]?.label||c.lossReason}</span>`:''}</div><div class="deal-progress"><div class="deal-progress-fill" style="width:${p.pct}%"></div></div><div class="deal-next">Следующее: ${nextAction(c)} · касание ${c.nextTouchDate||'не назначено'}</div></div>`}function nextAction(c){if(c.stage==='losing')return c.lossAction||'выбрать действие';const d=c.deals?.at(-1),idx=(d?.sop||[]).findIndex(x=>!x);return idx<0?'завершить сделку':DEAL_SOP_STEPS[idx].title}
function safeModalRender(fn,targetId){try{fn()}catch(e){console.error(e);const target=document.getElementById(targetId);if(target)target.innerHTML=`<div class="empty-col">Ошибка вкладки: ${esc(e.message||e)}</div>`}}function openClient(id){activeClientId=String(id);const c=clients.find(x=>String(x.id)===String(id));if(!c){alert('Клиент не найден');return}normalizeClient(c);if(!c.createdAt)c.createdAt=new Date().toISOString();if(!Array.isArray(c.deals))c.deals=[{id:gid(),createdAt:c.createdAt,amount:c.amount||0,stage:c.stage||'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)}];save();document.getElementById('cm-name').textContent=c.name;document.getElementById('cm-meta').textContent=`${c.city} · ${c.phone||'телефон не указан'} · ${c.username||'username не указан'} · ${c.category}`;document.getElementById('client-modal').classList.add('open');switchTab('checklist',document.querySelector('.md-tab'));safeModalRender(()=>renderChecklist(c),'sop-steps');safeModalRender(()=>loadCalc(c),'calc-client-msg');safeModalRender(()=>renderLoss(c),'loss-content');safeModalRender(()=>renderHistory(c),'deals-history');safeModalRender(()=>renderTouches(c),'touch-content');safeModalRender(()=>renderTelegramClient(c),'telegram-client-content');safeModalRender(()=>loadInfo(c),'mtab-info')}function closeModal(){document.getElementById('client-modal').classList.remove('open');activeClientId=null;renderCRM();renderArchive();renderCabinet()}function switchTab(id,el){document.querySelectorAll('.mtc').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.md-tab').forEach(t=>t.classList.remove('active'));const tab=document.getElementById('mtab-'+id);if(tab)tab.classList.add('active');if(el)el.classList.add('active');const c=clients.find(x=>String(x.id)===String(activeClientId));if(id==='calc')safeModalRender(()=>doCalc(),'calc-client-msg');if(id==='loss')safeModalRender(()=>renderLoss(c),'loss-content');if(id==='touch')safeModalRender(()=>renderTouches(c),'touch-content');if(id==='chat')safeModalRender(()=>renderTelegramClient(c),'telegram-client-content')}
function renderChecklist(c){const d=c.deals?.at(-1),sop=d?.sop||Array(DEAL_SOP_STEPS.length).fill(false),p=progress(c),txt=document.getElementById('sop-prog-txt'),bar=document.getElementById('sop-bar'),steps=document.getElementById('sop-steps');if(!txt||!bar||!steps)return;txt.textContent=`${p.done} / ${p.total} · ${p.pct}%`;bar.style.width=p.pct+'%';steps.innerHTML=DEAL_SOP_STEPS.map((s,i)=>`<div class="sop-step ${sop[i]?'done':''}" id="ss${i}"><div class="sop-step-head" data-onclick="toggleSOPBody(${i})"><input class="sop-step-chk" type="checkbox" ${sop[i]?'checked':''} data-onclick="event.stopPropagation();toggleSOP(${i})"><span class="sop-step-title">${i+1}. ${s.title}</span><span class="sop-step-tag">${s.tag}</span><span>▾</span></div><div class="sop-step-body"><p>${s.desc}</p><div class="msg-lbl">Текст</div><div class="msg-box" id="sm${i}">${esc(s.msg(c))}</div><button class="copy-btn" data-onclick="copyEl('sm${i}',this)">Скопировать</button></div></div>`).join('')}function toggleSOPBody(i){document.getElementById('ss'+i).classList.toggle('open')}function toggleSOP(i){const c=clients.find(x=>x.id===activeClientId),d=c?.deals?.at(-1);if(!d)return;d.sop[i]=!d.sop[i];save();renderChecklist(c);renderCRM();}
function selCalcDir(el,dir){calcDir=dir;document.querySelectorAll('.cdt').forEach(d=>d.classList.remove('active'));el.classList.add('active');doCalc()}function selCalcInput(mode){calcInputMode=mode;document.getElementById('ci-rub').classList.toggle('sel',mode==='rub');document.getElementById('ci-usdt').classList.toggle('sel',mode==='usdt');document.getElementById('mc-hint').textContent=mode==='rub'?'Введи рубли → получишь USDT':'Введи USDT → получишь рубли';doCalc()}function loadCalc(c){document.getElementById('mc-rate').value=c.calcData?.rate??82;document.getElementById('mc-spread').value=c.calcData?.spread??.2;document.getElementById('mc-amount').value=c.calcData?.amount||c.amount||'';document.getElementById('mc-fee').checked=!!c.calcData?.fee;calcDir=c.direction==='sell'?'sell':'buy';document.querySelectorAll('.cdt').forEach(d=>d.classList.toggle('active',d.textContent===(calcDir==='sell'?'Клиенту нужны рубли':'Клиенту нужно USDT')));doCalc()}function doCalc(){const c=clients.find(x=>x.id===activeClientId),rate=+document.getElementById('mc-rate').value||82,spread=+document.getElementById('mc-spread').value||0,amount=+document.getElementById('mc-amount').value||0,fee=document.getElementById('mc-fee').checked,isBuy=calcDir==='buy';let clientRate,usdt=0,rub=0,earnUsdt=0;if(isBuy){clientRate=rate+spread;if(calcInputMode==='rub'){rub=amount;usdt=rub/clientRate-(fee?4:0)}else{usdt=amount;rub=(usdt+(fee?4:0))*clientRate}earnUsdt=rub/rate-rub/clientRate}else{clientRate=rate-spread;if(calcInputMode==='usdt'){usdt=amount;rub=(usdt-(fee?4:0))*clientRate}else{rub=amount;usdt=rub/clientRate+(fee?4:0)}earnUsdt=rub/clientRate-rub/rate}if(c){c.calcData={rate,spread,amount,mode:calcInputMode,fee};save()}document.getElementById('r-rate').textContent=clientRate.toFixed(2);document.getElementById('r-usdt').textContent=amount?Math.max(0,Math.floor(usdt)).toLocaleString('ru')+' USDT':'—';document.getElementById('r-rub').textContent=amount?Math.max(0,Math.round(rub)).toLocaleString('ru')+' ₽':'—';document.getElementById('r-usdt-lbl').textContent=isBuy?'USDT клиенту':'USDT от клиента';document.getElementById('r-rub-lbl').textContent=isBuy?'Рублей к приёму':'Рублей к выдаче';document.getElementById('r-earn').textContent=amount?'~'+Math.max(0,Math.round(earnUsdt*rate)).toLocaleString('ru')+' ₽':'—';const feeLine=fee?'Комиссия 4 USDT включена, потому что сумма сделки меньше 3000$. Это наша комиссия за мелкую сумму.':'';document.getElementById('calc-client-msg').textContent=`Курс для вас: ${clientRate.toFixed(2)} руб за USDT\n${amount?(isBuy?`При сумме ${Math.round(rub).toLocaleString('ru')} руб → получите ${Math.max(0,Math.floor(usdt)).toLocaleString('ru')} USDT`:`${Math.max(0,Math.floor(usdt)).toLocaleString('ru')} USDT → получите ${Math.round(rub).toLocaleString('ru')} руб`)+'\n':''}${feeLine?feeLine+'\n':''}Курс зафиксируем — после подтверждения не изменится.\nПодходит?`}
function openLossMode(){const c=clients.find(x=>String(x.id)===String(activeClientId));if(!c)return;c.stage='losing';if(!LOSS_REASONS[c.lossReason])c.lossReason='thinking';if(!c.followUpDate)c.followUpDate=new Date(Date.now()+86400000).toISOString().split('T')[0];if(!c.lossAction)c.lossAction='Мягко напомнить сегодня';save();renderLoss(c);renderCRM();switchTab('loss',document.querySelectorAll('.md-tab')[2])}function renderLoss(c){const el=document.getElementById('loss-content');if(!el)return;if(!c){el.innerHTML='';return}if(!LOSS_REASONS[c.lossReason])c.lossReason='thinking';const r=LOSS_REASONS[c.lossReason]||LOSS_REASONS.thinking;const said=r.said,actions=r.actions;el.innerHTML=`<div class="loss-panel"><div class="loss-title">Клиент сливается</div><p>Фиксируем унифицированную причину, что сказал клиент и следующее действие. Это нужно для статистики и повторного касания.</p></div><div class="card"><div class="card-title">Причина</div><select class="fs" id="loss-reason" data-onchange="changeLossReason(this.value)">${Object.entries(LOSS_REASONS).map(([k,v])=>`<option value="${k}" ${c.lossReason===k?'selected':''}>${v.label}</option>`).join('')}</select></div><div class="card"><div class="card-title">Что сказал клиент</div><select class="fs" id="loss-said" data-onchange="toggleLossCustom()">${said.map(s=>`<option ${c.clientSaid===s?'selected':''}>${s}</option>`).join('')}</select><div class="loss-custom ${(c.clientSaid==='Другое')?'show':''}" id="loss-custom-wrap"><input class="fi" id="loss-comment" value="${esc(c.lossComment)}" placeholder="Комментарий менеджера"></div></div><div class="card"><div class="card-title">Скрипт</div><div class="loss-script" id="loss-script">${scriptFor(c.lossReason||'thinking')}</div><button class="copy-btn" data-onclick="copyEl('loss-script',this)">Скопировать</button></div><div class="card"><div class="card-title">Следующее действие</div><div class="loss-select-row"><div><div class="fl">Действие</div><select class="fs" id="loss-action">${actions.map(a=>`<option ${c.lossAction===a?'selected':''}>${a}</option>`).join('')}<option ${!actions.includes(c.lossAction)&&c.lossAction?'selected':''}>${esc(c.lossAction||'Ручное действие')}</option></select></div><div><div class="fl">Дата</div><input class="fi" type="date" id="loss-date" value="${c.followUpDate||today()}"></div></div><div class="quick-actions"><button class="btn btn-b" data-onclick="saveLossTask(event)">Сохранить задачу</button><button class="btn btn-g" data-onclick="returnToWork()">Вернулся в работу</button><button class="btn btn-r" data-onclick="finishDeal('lost')">Завершить потерей</button></div></div>`}function scriptFor(k){return{expensive:'Понимаю, вопрос курса важен. Подскажите, какая разница для вас критична? Если курс сдвинется, я смогу быстро вернуться с предложением.',competitor:'Понял вас. Аккуратно уточню: вам уже подтвердили финальную сумму к выдаче? Иногда на финальном этапе условия меняются.',trust:'Понимаю. Мы проводим сделки в офисе, с живым менеджером и фиксируем условия заранее. Могу отправить адрес, отзывы и коротко объяснить процесс.',thinking:'Хорошо, понимаю. Чтобы вам было проще принять решение: могу зафиксировать условия на короткое время и сразу согласовать окно в офисе.',nomoney:'Понял. Тогда зафиксирую, что вопрос переносится. На какую дату ориентироваться, чтобы я заранее проверил курс и кассу?',other:'Понял. Напишите, пожалуйста, что именно смущает — я посмотрю, как можем решить вопрос.'}[k]||LOSS_REASONS.thinking.actions[0]}
function changeLossReason(k){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.lossReason=k;c.clientSaid=LOSS_REASONS[k].said[0];c.lossAction=LOSS_REASONS[k].actions[0];c.followUpDate=new Date(Date.now()+LOSS_REASONS[k].days*86400000).toISOString().split('T')[0];save();renderLoss(c);renderCRM()}function toggleLossCustom(){document.getElementById('loss-custom-wrap')?.classList.toggle('show',document.getElementById('loss-said')?.value==='Другое')}function saveLossTask(e){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.stage='losing';c.lossReason=document.getElementById('loss-reason').value;c.clientSaid=document.getElementById('loss-said').value;c.lossComment=document.getElementById('loss-comment')?.value||'';c.lossAction=document.getElementById('loss-action').value;c.followUpDate=document.getElementById('loss-date').value;save();renderLoss(c);renderCRM();if(e?.target){let o=e.target.textContent;e.target.textContent='Задача сохранена ✓';setTimeout(()=>e.target.textContent=o,1200)}}function returnToWork(){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.stage='active';c.nextTouchDate=c.nextTouchDate||nextTouchDate(c.touchFrequency);save();renderCRM();renderChecklist(c);switchTab('checklist',document.querySelector('.md-tab'))}function repeatDeal(){const c=clients.find(x=>x.id===activeClientId);if(!c)return;const raw=prompt('Сумма повторной сделки, ₽:',c.amount||'');if(raw===null)return;const amt=+String(raw).replace(/\s/g,'')||c.amount||0;c.stage='active';c.amount=amt;c.createdAt=new Date().toISOString();c.closedAt='';c.lossReason='';c.lossAction='';c.followUpDate='';c.nextTouchDate=nextTouchDate(c.touchFrequency||DEFAULT_TOUCH_DAYS);c.deals=c.deals||[];c.deals.push({id:gid(),createdAt:new Date().toISOString(),amount:amt,stage:'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)});save();renderCRM();renderArchive();renderHistory(c);renderChecklist(c);switchTab('checklist',document.querySelector('.md-tab'))}function finishDeal(status){const c=clients.find(x=>x.id===activeClientId);if(!c)return;const d=c.deals?.at(-1);c.stage=status;c.closedAt=new Date().toISOString();if(d){d.stage=status;d.closedAt=c.closedAt;if(status==='done')d.sop=Array(DEAL_SOP_STEPS.length).fill(true)}if(status==='lost'&&!c.lossReason)c.lossReason='other';save();renderCRM();renderArchive();renderCabinet();if(status==='done')renderChecklist(c);switchTab('history',document.querySelectorAll('.md-tab')[3])}
function renderHistory(c){document.getElementById('deals-history').innerHTML=(c.deals||[]).map((d,i)=>`<div class="dhi"><span class="dhi-date">${(d.createdAt||'').split('T')[0]}</span><span>Сделка ${i+1}</span><span class="dhi-amt">${d.amount?fmt(d.amount)+' ₽':'—'} · ${d.stage}</span></div>`).join('')||'<div class="empty-col">История пуста</div>'}function renderTouches(c){const root=document.getElementById('touch-content');if(!root||!c)return;root.innerHTML=`<div class="card"><div class="card-title">Дорожка касаний</div><p>Отдельно от этапов сделки: CRM поднимает клиента между обменами, чтобы не терять повторные сделки.</p><div class="touch-grid"><div><div class="fl">Частота, дней</div><input class="fi" id="touch-frequency" type="number" min="1" value="${c.touchFrequency||DEFAULT_TOUCH_DAYS}"></div><div><div class="fl">Следующее касание</div><input class="fi" id="touch-date" type="date" value="${c.nextTouchDate||today()}"></div><div><div class="fl">Действие</div><select class="fs" id="touch-action"><option>Написать в Telegram</option><option>Позвонить</option><option>Проверить курс и написать</option><option>Назначить встречу</option></select></div></div><div style="margin-top:10px"><div class="fl">Комментарий касания</div><textarea class="fi" id="touch-comment" rows="3" placeholder="Что сказали / что сделать дальше"></textarea></div><div class="quick-actions"><button class="btn btn-g" data-onclick="saveTouch()">Сохранить касание</button><button class="btn btn-b" data-onclick="markTouchDone()">Касание выполнено</button></div><div class="touch-log">${(c.touches||[]).slice().reverse().map(t=>`<div class="touch-log-row"><span class="g">${t.date}</span> · ${esc(t.action)} · ${esc(t.comment||'без комментария')}</div>`).join('')||'<div class="empty-col">Касаний пока нет</div>'}</div></div>`}function saveTouch(){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.touchFrequency=+document.getElementById('touch-frequency').value||DEFAULT_TOUCH_DAYS;c.nextTouchDate=document.getElementById('touch-date').value||nextTouchDate(c.touchFrequency);c.touches=c.touches||[];c.touches.push({date:new Date().toISOString().split('T')[0],action:document.getElementById('touch-action').value,comment:document.getElementById('touch-comment').value.trim(),manager:profile?.login});save();renderTouches(c);renderCRM()}function markTouchDone(){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.touchFrequency=+document.getElementById('touch-frequency').value||DEFAULT_TOUCH_DAYS;c.nextTouchDate=nextTouchDate(c.touchFrequency);document.getElementById('touch-date').value=c.nextTouchDate;saveTouch()}function renderTelegramClient(c){const root=document.getElementById('telegram-client-content');if(!root||!c)return;const u=(c.telegramChat?.username||c.username||'').replace('@','');const messages=(c.telegramMessages||[]).slice(-20).reverse();root.innerHTML=`<div class="card"><div class="card-title">Telegram клиента</div><div class="fg3" style="margin-bottom:10px"><div><div class="fl">Чат / имя</div><input class="fi" id="tg-client-title" value="${esc(c.telegramChat?.title||c.name)}"></div><div><div class="fl">Username</div><input class="fi" id="tg-client-username" value="${esc(c.telegramChat?.username||c.username||'')}" placeholder="@username"></div><div><div class="fl">Chat ID</div><input class="fi" id="tg-client-chatid" value="${esc(c.telegramChat?.chatId||'')}" placeholder="заполнит коннектор"></div></div><div class="msg-lbl">Сообщение менеджера</div><textarea class="fi" id="tg-draft" rows="4">Здравствуйте! Хотел напомнить о Атом. Если планируете обмен, могу проверить курс и окно в офисе.</textarea><div class="quick-actions"><button class="btn btn-g" data-onclick="saveClientTelegram()">Привязать чат</button><button class="btn btn-b" data-onclick="syncGoogle()">Сохранить привязку в Google</button><button class="btn btn-b" data-onclick="copyEl('tg-draft',this)">Скопировать текст</button>${u?'<button class="btn" data-onclick="window.open(\'https://t.me/'+u+'\',\'_blank\')">Открыть Telegram</button>':''}</div><div class="sync-state">После привязки запусти npm run history в telegram_connector. История появится в листе telegram_messages и здесь после загрузки из Google.</div></div><div class="card"><div class="card-title">История Telegram</div>${messages.map(m=>`<div class="touch-log-row"><span class="g">${esc(String(m.date||'').replace('T',' ').slice(0,16))}</span> · ${esc(m.sender||'')}<br>${esc(m.text||'')}</div>`).join('')||'<div class="empty-col">История еще не импортирована</div>'}</div>`}function saveClientTelegram(){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.telegramChat={...(c.telegramChat||{}),title:document.getElementById('tg-client-title').value.trim()||c.name,username:document.getElementById('tg-client-username').value.trim(),chatId:document.getElementById('tg-client-chatid').value.trim(),status:'linked'};c.username=c.telegramChat.username||c.username;c.source='Telegram';save();renderTelegramClient(c);renderCRM()}function loadInfo(c){document.getElementById('mi-name').value=c.name;document.getElementById('mi-city').value=c.city;document.getElementById('mi-phone').value=c.phone||'';document.getElementById('mi-username').value=c.username||'';document.getElementById('mi-amount').value=c.amount||'';document.getElementById('mi-source').value=c.source||'Telegram';document.getElementById('mi-category').value=c.category||CLIENT_CATEGORIES[0];document.getElementById('mi-touch-frequency').value=c.touchFrequency||DEFAULT_TOUCH_DAYS;document.getElementById('mi-next-touch').value=c.nextTouchDate||today();document.getElementById('mi-comment').value=c.comment||''}function saveInfo(e){const c=clients.find(x=>x.id===activeClientId);if(!c)return;c.name=document.getElementById('mi-name').value.trim()||c.name;c.city=document.getElementById('mi-city').value;c.phone=document.getElementById('mi-phone').value.trim();c.username=document.getElementById('mi-username').value.trim();c.amount=+document.getElementById('mi-amount').value||c.amount;c.source=document.getElementById('mi-source').value;c.category=document.getElementById('mi-category').value;c.touchFrequency=+document.getElementById('mi-touch-frequency').value||DEFAULT_TOUCH_DAYS;c.nextTouchDate=document.getElementById('mi-next-touch').value||nextTouchDate(c.touchFrequency);c.comment=document.getElementById('mi-comment').value;save();document.getElementById('cm-name').textContent=c.name;document.getElementById('cm-meta').textContent=`${c.city} · ${c.phone||'телефон не указан'} · ${c.username||'username не указан'} · ${c.category}`;renderCRM();renderTouches(c);if(e?.target){let o=e.target.textContent;e.target.textContent='Сохранено ✓';setTimeout(()=>e.target.textContent=o,1200)}}
function renderArchive(){const root=document.getElementById('archive-content');if(!root)return;root.innerHTML=`<div class="card"><div class="card-title">Архив</div><p>Закрытые и потерянные сделки. Фильтры: статус, причина, город, источник, поиск по имени/телефону/username.</p></div><div class="archive-toolbar"><input class="search-box" id="archive-search" placeholder="Поиск" data-oninput="filterArchive()"><select class="filter-sel" id="archive-status" data-onchange="filterArchive()"><option value="">Все статусы</option><option value="done">Успешно</option><option value="lost">Потеряно</option></select><select class="filter-sel" id="archive-city" data-onchange="filterArchive()"><option value="">Все города</option>${CITIES.map(c=>`<option>${c}</option>`).join('')}</select><select class="filter-sel" id="archive-reason" data-onchange="filterArchive()"><option value="">Все причины</option>${Object.entries(LOSS_REASONS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select><select class="filter-sel" id="archive-source" data-onchange="filterArchive()"><option value="">Все источники</option>${SOURCES.map(s=>`<option>${s}</option>`).join('')}</select></div><div id="archive-summary"></div><div class="archive-grid" id="archive-list"></div>`;filterArchive()}function filterArchive(){const q=(document.getElementById('archive-search')?.value||'').toLowerCase(),st=document.getElementById('archive-status')?.value||'',city=document.getElementById('archive-city')?.value||'',reason=document.getElementById('archive-reason')?.value||'',source=document.getElementById('archive-source')?.value||'';const list=archivedList().filter(c=>(!st||c.stage===st)&&(!city||c.city===city)&&(!reason||c.lossReason===reason)&&(!source||c.source===source)&&(!q||[c.name,c.phone,c.username,c.city,c.source,c.lossComment].join(' ').toLowerCase().includes(q))).sort((a,b)=>new Date(b.closedAt||b.createdAt)-new Date(a.closedAt||a.createdAt));const done=list.filter(c=>c.stage==='done'),lost=list.filter(c=>c.stage==='lost'),rub=done.reduce((s,c)=>s+c.amount,0);document.getElementById('archive-summary').innerHTML=`<div class="dash-mini-grid" style="grid-template-columns:repeat(4,1fr)">${metric('В архиве',list.length,'все сделки',100)}${metric('Успешно',done.length,'закрытые',list.length?done.length/list.length*100:0)}${metric('Потеряно',lost.length,'потери',list.length?lost.length/list.length*100:0)}${metric('Оборот',(rub/1e6).toFixed(1)+'M ₽','успешные сделки',72)}</div>`;document.getElementById('archive-list').innerHTML=list.map(c=>`<div class="archive-card ${c.stage}" data-onclick="openClient('${c.id}')"><div class="archive-top"><div><div class="archive-name">${esc(c.name)}</div><div class="archive-meta">${c.city} · ${c.source}</div></div><span class="archive-status ${c.stage}">${c.stage==='done'?'Успешно':'Потеряно'}</span></div><div class="archive-money">${c.amount?fmt(c.amount)+' ₽':'сумма не указана'}</div><div class="contact-mini">${c.phone?`<span class="contact-pill">${esc(c.phone)}</span>`:''}${c.username?`<span class="contact-pill">${esc(c.username)}</span>`:''}${c.lossReason?`<span class="contact-pill red">${LOSS_REASONS[c.lossReason]?.label}</span>`:''}</div>${c.stage==='lost'?`<div class="archive-meta">Касание: ${c.followUpDate||'не назначено'} · ${esc(c.lossAction||'действие не выбрано')}</div>`:''}</div>`).join('')||'<div class="empty-col">В архиве пусто</div>'}
function barRow(name,val,max){return`<div class="stat-bar-row"><div class="stat-bar-name">${name}</div><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(val/max*100)}%"></div></div><div class="stat-bar-val">${val}</div></div>`}
function renderCabinet(){
  const root=document.getElementById('cabinet-content');
  if(!root)return;
  const tg=integrations.telegram||{},gg=integrations.google||{},role=profile?.role||CREDENTIALS[profile?.login]?.role||'CRM';
  root.innerHTML=`<div class="cab-grid"><div class="card"><div class="card-title">Личный кабинет</div><div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(role)} · ${esc(profile?.city||'Уфа')} · login: ${esc(profile?.login||'')}</div></div></div><hr><div class="dash-mini-grid" style="grid-template-columns:repeat(3,1fr)">${metric('Мои клиенты',clients.filter(c=>c.assignedTo===(profile?.login||'')).length,'назначены',80)}${metric('Касания',touchDueList().length,'сегодня/просрочено',60)}${metric('Архив',archivedList().length,'закрытые',70)}</div></div><div class="card"><div class="card-title">Состав кабинетов</div>${Object.entries(CREDENTIALS).map(([login,u])=>`<div class="chat-item"><div><b>${u.name}</b><div class="archive-meta">${u.role} · ${u.city}</div></div><span class="contact-pill">${login}</span></div>`).join('')}</div></div><div class="integration-grid"><div class="card"><div class="card-title">Telegram интеграция</div><div class="fg2" style="margin-bottom:10px"><div><div class="fl">Аккаунт Telegram</div><input class="fi" id="cab-tg-account" value="${esc(tg.account||'')}" placeholder="@atom_manager"></div><div><div class="fl">Стягивать чаты</div><select class="fs" id="cab-tg-mode"><option value="needed" ${tg.mode==='needed'?'selected':''}>Только нужные</option><option value="all" ${tg.mode==='all'?'selected':''}>Все чаты</option></select></div></div><div class="fl">Импорт чатов: имя | username | категория | сумма | город</div><textarea class="fi" id="cab-tg-raw" rows="5" placeholder="Иван | @ivan | Автомобили | 500000 | Уфа">${(tg.chats||[]).map(c=>`${c.title||''} | ${c.username||''} | ${c.category||'Криптообмен'} | ${c.amount||''} | ${c.city||'Уфа'}`).join('\n')}</textarea><div class="quick-actions"><button class="btn btn-g" data-onclick="saveCabinet()">Сохранить</button><button class="btn btn-b" data-onclick="loadDemoTelegramChats()">Демо-чаты</button><button class="btn" data-onclick="importTelegramChats()">Создать лиды из чатов</button></div><div class="sync-state">Для настоящего стягивания чатов нужен серверный коннектор Telegram MTProto/Bot API. Эта форма готовит структуру данных для него.</div></div><div class="card"><div class="card-title">Google Sheets как backend</div><div class="fg2" style="margin-bottom:10px"><div><div class="fl">Google Sheet ID</div><input class="fi" id="cab-sheet-id" value="${esc(gg.sheetId||'')}" placeholder="1abc..."></div><div><div class="fl">Apps Script WebApp URL</div><input class="fi" id="cab-webapp-url" value="${esc(gg.webAppUrl||'')}" placeholder="https://script.google.com/..."></div></div><div class="quick-actions"><button class="btn btn-g" data-onclick="saveCabinet()">Сохранить</button><button class="btn btn-b" data-onclick="syncGoogle()">Выгрузить в Google</button><button class="btn btn-b" data-onclick="loadGoogle()">Загрузить из Google</button><button class="btn" data-onclick="exportGooglePayload()">Payload</button></div><div class="sync-state" id="google-sync-state">Последняя синхронизация: ${esc(gg.lastSync||'не было')}</div><div class="msg-box" id="google-payload" style="display:none"></div></div></div>`;
}
function saveCabinet(){
  integrations.telegram.account=document.getElementById('cab-tg-account')?.value.trim()||'';
  integrations.telegram.mode=document.getElementById('cab-tg-mode')?.value||'needed';
  integrations.google.sheetId=document.getElementById('cab-sheet-id')?.value.trim()||'';
  integrations.google.webAppUrl=document.getElementById('cab-webapp-url')?.value.trim()||'';
  integrations.telegram.chats=parseTelegramRows(document.getElementById('cab-tg-raw')?.value||'');
  saveIntegrations();
  renderCabinet();
}
function parseTelegramRows(raw){
  return raw.split(/\n+/).map(s=>s.trim()).filter(Boolean).map(line=>{
    const [title='',username='',category='Криптообмен',amount='',city='Уфа']=line.split('|').map(x=>x.trim());
    return{title,username,category:CLIENT_CATEGORIES.includes(category)?category:'Криптообмен',amount:+amount.replace(/\s/g,'')||0,city:CITIES.includes(city)?city:'Уфа'};
  });
}
function loadDemoTelegramChats(){
  const rows=['Авто Китай опт | @auto_china | Автомобили | 1200000 | Уфа','Цветы Европа | @flowers_eu | Цветы | 450000 | Екатеринбург','Импорт табака | @tabak_import | Табак / уголь | 700000 | Казань'];
  document.getElementById('cab-tg-raw').value=rows.join('\n');
  saveCabinet();
}
function importTelegramChats(){
  saveCabinet();
  const owner=profile?.login||'nikita';
  (integrations.telegram.chats||[]).forEach(ch=>{
    const exists=clients.some(c=>(c.username&&ch.username&&c.username.toLowerCase()===ch.username.toLowerCase())||c.name===ch.title);
    if(exists)return;
    clients.unshift(normalizeClient({id:gid(),name:ch.title||ch.username||'Telegram чат',phone:'',username:ch.username,city:ch.city,source:'Telegram',category:ch.category,amount:ch.amount,direction:'buy',assignedTo:owner,stage:'active',createdAt:new Date().toISOString(),nextTouchDate:today(),touchFrequency:DEFAULT_TOUCH_DAYS,telegramChat:{title:ch.title,username:ch.username,status:'imported'},comment:'Импортировано из Telegram',deals:[{id:gid(),createdAt:new Date().toISOString(),amount:ch.amount,stage:'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)}],calcData:{rate:82,spread:.2,amount:ch.amount,fee:ch.amount<250000}}));
  });
  save();
  renderCRM();
  renderCabinet();
}
function googlePayload(){
  return{sheetId:integrations.google.sheetId,exportedAt:new Date().toISOString(),profile,clients:clients.map(c=>({id:c.id,name:c.name,phone:c.phone,username:c.username,city:c.city,category:c.category,source:c.source,amount:c.amount,direction:c.direction,stage:c.stage,assignedTo:c.assignedTo,nextTouchDate:c.nextTouchDate,touchFrequency:c.touchFrequency,lossReason:c.lossReason,lossAction:c.lossAction,comment:c.comment,telegramChat:c.telegramChat,telegramMessages:c.telegramMessages,deals:c.deals,touches:c.touches}))};
}
function syncGoogle(){
  saveCabinet();
  const payload=googlePayload();
  integrations.google.lastPayload=JSON.stringify(payload,null,2);
  const state=document.getElementById('google-sync-state');
  if(!integrations.google.webAppUrl){state.textContent='Укажите Apps Script WebApp URL или выгрузите Payload';saveIntegrations();return}
  const frameName='sync_frame_'+Date.now();
  const iframe=document.createElement('iframe');
  iframe.name=frameName;
  iframe.style.display='none';
  document.body.appendChild(iframe);
  const form=document.createElement('form');
  form.method='POST';
  form.action=integrations.google.webAppUrl;
  form.target=frameName;
  form.style.display='none';
  const input=document.createElement('input');
  input.type='hidden';
  input.name='payload';
  input.value=JSON.stringify(payload);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  integrations.google.lastSync=new Date().toLocaleString('ru-RU');
  state.textContent='Отправлено формой: '+integrations.google.lastSync+'. Обновите Google Таблицу через 5-10 секунд.';
  setTimeout(()=>{form.remove();iframe.remove()},15000);
  saveIntegrations();
}
function exportGooglePayload(){
  saveCabinet();
  const box=document.getElementById('google-payload');
  const payload=JSON.stringify(googlePayload(),null,2);
  integrations.google.lastPayload=payload;
  saveIntegrations();
  box.style.display='block';
  box.textContent=payload;
}
function loadGoogle(){
  saveCabinet();
  const state=document.getElementById('google-sync-state');
  if(!integrations.google.webAppUrl){state.textContent='Укажите Apps Script WebApp URL';return}
  const callbackName='__load1exCrm'+Date.now();
  window[callbackName]=(data)=>{
    try{
      if(!data||!data.ok||!Array.isArray(data.clients))throw new Error(data?.error||'Ответ Google без clients');
      clients=data.clients.map(normalizeClient);
      save();
      integrations.google.lastSync=new Date().toLocaleString('ru-RU');
      saveIntegrations();
      renderCRM();
      renderArchive();
      renderCabinet();
      state.textContent='Загружено из Google: '+clients.length+' клиентов';
    }catch(e){
      state.textContent='Ошибка загрузки из Google: '+e.message;
    }finally{
      delete window[callbackName];
      document.getElementById(callbackName)?.remove();
    }
  };
  const script=document.createElement('script');
  script.id=callbackName;
  script.src=integrations.google.webAppUrl+(integrations.google.webAppUrl.includes('?')?'&':'?')+'action=export&callback='+callbackName;
  script.onerror=()=>{state.textContent='Не удалось загрузить данные из Google';delete window[callbackName];script.remove()};
  document.body.appendChild(script);
  state.textContent='Загружаю данные из Google...';
}

function copyEl(id,btn){navigator.clipboard.writeText(document.getElementById(id).textContent).then(()=>{if(btn){const o=btn.textContent;btn.textContent='Скопировано ✓';setTimeout(()=>btn.textContent=o,1200)}})}function exportData(){const blob=new Blob([JSON.stringify({clients,profile,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='atom_live_crm_v7_'+today()+'.json';a.click();URL.revokeObjectURL(a.href)}function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(d.clients){clients=d.clients;profile=d.profile||profile;save();saveProfile();applyProfile();normalizeAll();renderCRM();renderArchive();renderCabinet();alert('Импортировано: '+clients.length)}}catch{alert('Ошибка файла')}};r.readAsText(f);e.target.value=''}
document.addEventListener('click',e=>{const card=e.target.closest?.('.deal-card[data-client-id]');if(card&&card.dataset.clientId){openClient(card.dataset.clientId)}});
document.addEventListener('DOMContentLoaded',()=>{});

async function linkAndImportTelegram(btn){
  const c=clients.find(x=>x.id===activeClientId);
  if(!c)return;
  const old=btn?.textContent;
  if(btn){btn.textContent='Import...';btn.style.pointerEvents='none'}
  try{
    c.telegramChat={
      ...(c.telegramChat||{}),
      title:document.getElementById('tg-client-title')?.value.trim()||c.name,
      username:document.getElementById('tg-client-username')?.value.trim()||c.username||'',
      chatId:document.getElementById('tg-client-chatid')?.value.trim()||'',
      status:'linked'
    };
    c.username=c.telegramChat.username||c.username;
    c.source='Telegram';

    const response=await fetch('http://127.0.0.1:8787/api/link-chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        client:{
          id:c.id,
          name:c.name,
          phone:c.phone,
          username:c.username,
          city:c.city,
          category:c.category,
          source:c.source,
          amount:c.amount,
          direction:c.direction,
          stage:c.stage,
          assignedTo:c.assignedTo,
          nextTouchDate:c.nextTouchDate,
          touchFrequency:c.touchFrequency,
          lossReason:c.lossReason,
          lossAction:c.lossAction,
          comment:c.comment,
          telegramChat:c.telegramChat,
          deals:c.deals,
          touches:c.touches
        },
        googleSheetId:integrations.google.sheetId,
        googleWebAppUrl:integrations.google.webAppUrl,
        historyLimit:100
      })
    });
    const data=await response.json();
    if(!data.ok)throw new Error(data.error||'Telegram bridge error');

    Object.assign(c,normalizeClient({...c,...data.client}));
    save();
    renderTelegramClient(c);
    renderCRM();
    alert('Telegram imported: '+(data.messagesCount||0)+' messages');
  }catch(e){
    alert('Telegram bridge error: '+e.message+'. Start it with npm run bridge in telegram_connector.');
  }finally{
    if(btn){btn.textContent=old;btn.style.pointerEvents=''}
  }
}
saveClientTelegram=function(){
  linkAndImportTelegram(document.querySelector('#telegram-client-content .btn-g'));
};

const SRM_API_BASE=location.origin&&location.origin.startsWith('http')?location.origin:'http://127.0.0.1:3000';
let authToken=sessionStorage.getItem('atom_auth_token')||'';
let __backendSaveTimer=null;
let __backendLoaded=false;
let __suppressBackendSync=false;
const __localSave=save;
const __localSaveProfile=saveProfile;

function clearLocalClientsCache(){
  try{localStorage.removeItem('atom_v7_clients')}catch(_){}
}

function canPersistClientsLocally(){
  return !authToken&&!__backendLoaded;
}

async function backendRequest(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(authToken)headers.Authorization='Bearer '+authToken;
  const response=await fetch(SRM_API_BASE+path,{
    ...options,
    headers
  });
  const data=await response.json();
  if(!data.ok)throw new Error(data.error||'Backend error');
  return data;
}

async function loadClientsFromBackend(){
  try{
    const data=await backendRequest('/api/clients');
    if(Array.isArray(data.clients)){
      __suppressBackendSync=true;
      clients=data.clients.map(normalizeClient);
      clearLocalClientsCache();
      __suppressBackendSync=false;
      renderCRM();
      renderArchive();
      renderCabinet();
    }
    __backendLoaded=true;
  }catch(e){
    console.warn('Backend load failed:',e.message);
    if(String(e.message||'').includes('Unauthorized')){
      authToken='';
      sessionStorage.removeItem('atom_auth_token');
      document.getElementById('app')?.classList.remove('visible');
      const auth=document.getElementById('auth-screen');
      if(auth)auth.style.display='flex';
    }
  }
}

function clientPayload(c){
  return {
    id:c.id,
    name:c.name,
    phone:c.phone,
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:c.amount,
    direction:c.direction,
    stage:c.stage,
    assignedTo:c.assignedTo,
    nextTouchDate:c.nextTouchDate,
    touchFrequency:c.touchFrequency,
    lossReason:c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    createdAt:c.createdAt,
    closedAt:c.closedAt,
    followUpDate:c.followUpDate,
    clientSaid:c.clientSaid,
    lossComment:c.lossComment,
    telegramChat:c.telegramChat,
    telegramMessages:c.telegramMessages,
    chatArchived:c.chatArchived,
    deals:c.deals,
    touches:c.touches,
    calcData:c.calcData
  };
}

async function syncClientsToBackendNow(){
  if(!clients)return;
  await backendRequest('/api/sync/clients',{
    method:'PUT',
    body:JSON.stringify({profile,clients:clients.map(clientPayload)})
  });
}

function scheduleBackendSync(){
  if(__suppressBackendSync||!__backendLoaded)return;
  clearTimeout(__backendSaveTimer);
  __backendSaveTimer=setTimeout(()=>syncClientsToBackendNow().catch(e=>console.warn('Backend sync failed:',e.message)),500);
}

save=function(){
  if(canPersistClientsLocally())__localSave();
  else clearLocalClientsCache();
  scheduleBackendSync();
};

saveProfile=function(){
  __localSaveProfile();
};

const __bootApp=bootApp;
bootApp=function(){
  __bootApp();
  loadClientsFromBackend();
};

const __renderCabinet=renderCabinet;
function warpStatusHtml(){
  const s=atomWarpStatus;
  const vpnOk=!!(s&&s.installed&&s.connected);
  const ok=!!(vpnOk&&s.telegramReachable);
  const provider=s?.provider||'VPN';
  const title=ok?'VPN + Telegram доступны':(vpnOk?'VPN включен, Telegram проверяется':'VPN не работает');
  const text=s
    ? `Канал: ${esc(provider)} · статус: ${s.connected?'подключен':'не подключен'} · proxy: ${s.proxyPort||'нет'} · страна=${esc(s.trace?.loc||'')} · узел=${esc(s.trace?.colo||'')} · ${esc(s.telegramCheck||'')}`
    : 'Статус VPN пока не получен от VPS.';
  const hint=ok
    ? 'Telegram backend ходит через локальный SOCKS5 proxy на VPS.'
    : 'Если код Telegram не приходит, проверь подписку VPN или выбери другой зарубежный сервер.';
  return `<div class="card" id="warp-status-card" style="border-color:${ok?'rgba(98,199,118,.45)':'rgba(255,83,98,.45)'}">
    <div class="card-title">VPS · ${title}</div>
    <div class="sync-state">${text}</div>
    <div class="archive-meta" style="margin-top:8px">${hint}</div>
  </div>`;
}

renderCabinet=function(){
  __renderCabinet();
  const root=document.getElementById('cabinet-content');
  if(!root||document.getElementById('local-backend-card'))return;
  root.insertAdjacentHTML('afterbegin',`<div class="card" id="local-backend-card"><div class="card-title">Local backend + PostgreSQL</div><p>Эта версия работает через локальный backend API: ${SRM_API_BASE}. Клиенты, сделки и Telegram-переписки сохраняются в PostgreSQL.</p><div class="quick-actions"><button class="btn btn-g" data-onclick="syncClientsToBackendNow().then(()=>alert('Saved to PostgreSQL'))">Сохранить в PostgreSQL</button><button class="btn btn-b" data-onclick="loadClientsFromBackend()">Загрузить из PostgreSQL</button></div></div>`);
};

async function linkAndImportTelegram(btn){
  const c=clients.find(x=>x.id===activeClientId);
  if(!c)return;
  const old=btn?.textContent;
  if(btn){btn.textContent='Import...';btn.style.pointerEvents='none'}
  try{
    c.telegramChat={
      ...(c.telegramChat||{}),
      title:document.getElementById('tg-client-title')?.value.trim()||c.name,
      username:document.getElementById('tg-client-username')?.value.trim()||c.username||'',
      chatId:document.getElementById('tg-client-chatid')?.value.trim()||'',
      status:'linked'
    };
    c.username=c.telegramChat.username||c.username;
    c.source='Telegram';
    await syncClientsToBackendNow();
    const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
      method:'POST',
      body:JSON.stringify({client:clientPayload(c),historyLimit:100})
    });
    Object.assign(c,normalizeClient({...c,...data.client}));
    __localSave();
    renderTelegramClient(c);
    renderCRM();
    alert('Telegram imported to PostgreSQL: '+(data.messagesCount||0)+' messages');
  }catch(e){
    alert('Backend/Telegram error: '+e.message+'. Check backend terminal and .env.');
  }finally{
    if(btn){btn.textContent=old;btn.style.pointerEvents=''}
  }
}

saveClientTelegram=function(){
  linkAndImportTelegram(document.querySelector('#telegram-client-content .btn-g'));
};

const __finalRenderCabinet=renderCabinet;
renderCabinet=function(){
  __finalRenderCabinet();
  const root=document.getElementById('cabinet-content');
  if(!root)return;
  [...root.querySelectorAll('.card')].forEach(card=>{
    const title=card.querySelector('.card-title')?.textContent||'';
    if(title.includes('Google Sheets'))card.remove();
  });
  const backendCard=document.getElementById('local-backend-card');
  if(backendCard){
    backendCard.querySelector('.card-title').textContent='Local backend + Postgres база';
    const text=backendCard.querySelector('p');
    if(text)text.textContent='Эта версия работает через локальный backend API: '+SRM_API_BASE+'. Клиенты, сделки и Telegram-переписки сохраняются в локальной Postgres-совместимой базе внутри проекта.';
    backendCard.querySelectorAll('button').forEach(button=>{
      button.textContent=button.textContent.includes('З')?'Загрузить из backend':'Сохранить в backend';
    });
  }
};

const __finalRenderTelegramClient=renderTelegramClient;
renderTelegramClient=function(c){
  __finalRenderTelegramClient(c);
  const root=document.getElementById('telegram-client-content');
  if(!root)return;
  [...root.querySelectorAll('button')].forEach(button=>{
    if(button.textContent.includes('Google'))button.remove();
  });
  const mainButton=root.querySelector('.btn-g');
  if(mainButton)mainButton.textContent='Привязать чат и импортировать';
  const state=root.querySelector('.sync-state');
  if(state)state.textContent='Backend сам импортирует историю выбранного Telegram-чата и сохранит ее в локальную базу. Для импорта нужен TELEGRAM_SESSION в .env.';
};

function plainText(value){
  return String(value ?? '').replace(/\s+/g,' ').trim();
}

function csvEscape(value){
  const text=plainText(value);
  return /[",;\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}

function exportClientsCsv(kind){
  const isArchive=kind==='archive';
  const source=isArchive?archivedList():clients.filter(c=>!['done','lost'].includes(c.stage));
  const rows=source.map(c=>({
    name:c.name,
    phone:c.phone,
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:c.amount,
    direction:c.direction==='sell'?'USDT -> RUB':'RUB -> USDT',
    stage:c.stage,
    assignedTo:c.assignedTo,
    nextTouchDate:c.nextTouchDate,
    touchFrequency:c.touchFrequency,
    lossReason:c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    telegramChat:c.telegramChat?.title||c.telegramChat?.username||'',
    telegramMessages:Array.isArray(c.telegramMessages)?c.telegramMessages.length:0,
    createdAt:c.createdAt,
    closedAt:c.closedAt
  }));
  const headers=[
    'name','phone','username','city','category','source','amount','direction','stage','assignedTo',
    'nextTouchDate','touchFrequency','lossReason','lossAction','comment','telegramChat','telegramMessages','createdAt','closedAt'
  ];
  const csv='\uFEFF'+[
    headers.join(';'),
    ...rows.map(row=>headers.map(header=>csvEscape(row[header])).join(';'))
  ].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(isArchive?'atom_archive_clients_':'atom_active_clients_')+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

const __exportRenderCRM=renderCRM;
renderCRM=function(){
  __exportRenderCRM();
  const toolbar=document.querySelector('#page-crm .live-toolbar');
  if(toolbar&&!document.getElementById('export-active-clients')){
    toolbar.insertAdjacentHTML('beforeend',`<button class="btn btn-b" id="export-active-clients" data-onclick="exportClientsCsv('active')">↓ Экспорт активных</button>`);
  }
};

const __exportRenderArchive=renderArchive;
renderArchive=function(){
  __exportRenderArchive();
  const root=document.getElementById('archive-content');
  if(root&&!document.getElementById('export-archive-clients')){
    root.insertAdjacentHTML('afterbegin',`<div class="live-toolbar"><button class="btn btn-b" id="export-archive-clients" data-onclick="exportClientsCsv('archive')">↓ Экспорт архива</button></div>`);
  }
};

const __cleanCabinetRender=renderCabinet;
renderCabinet=function(){
  __cleanCabinetRender();
  const root=document.getElementById('cabinet-content');
  if(!root)return;
  document.getElementById('local-backend-card')?.remove();
  [...root.querySelectorAll('.card')].forEach(card=>{
    const title=plainText(card.querySelector('.card-title')?.textContent||'').toLowerCase();
    if(title.includes('telegram')||title.includes('google sheets')||title.includes('backend')||title.includes('postgres')){
      card.remove();
    }
  });
  const grid=root.querySelector('.integration-grid');
  if(grid&&!plainText(grid.textContent))grid.remove();
};

renderCRM();
renderArchive();
renderCabinet();

function formatExportDate(value){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return plainText(value);
  return date.toLocaleDateString('ru-RU');
}

function exportClientsCsv(kind){
  const isArchive=kind==='archive';
  const source=isArchive?archivedList():clients.filter(c=>!['done','lost'].includes(c.stage));
  const rows=source.map(c=>({
    name:c.name,
    phone:c.phone,
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:c.amount,
    direction:c.direction==='sell'?'USDT -> RUB':'RUB -> USDT',
    stage:c.stage,
    assignedTo:c.assignedTo,
    nextTouchDate:formatExportDate(c.nextTouchDate),
    lossReason:c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    createdAt:formatExportDate(c.createdAt),
    closedAt:formatExportDate(c.closedAt)
  }));
  const headers=[
    'name','phone','username','city','category','source','amount','direction','stage','assignedTo',
    'nextTouchDate','lossReason','lossAction','comment','createdAt','closedAt'
  ];
  const csv='\uFEFF'+[
    headers.join(';'),
    ...rows.map(row=>headers.map(header=>csvEscape(row[header])).join(';'))
  ].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(isArchive?'atom_archive_clients_':'atom_active_clients_')+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function cleanTopbarImportExport(){
  document.querySelectorAll('.topbar button').forEach(button=>{
    const action=button.getAttribute('onclick')||'';
    if(action.includes('exportData')||action.includes('importFile'))button.remove();
  });
  document.getElementById('importFile')?.remove();
}

const __cleanShowPage=showPage;
showPage=function(id,el){
  __cleanShowPage(id,el);
  cleanTopbarImportExport();
};

cleanTopbarImportExport();

function formatExportPhone(value){
  const digits=String(value||'').replace(/\D/g,'');
  let normalized=digits;
  if(normalized.length===11&&normalized[0]==='8')normalized='7'+normalized.slice(1);
  if(normalized.length===10)normalized='7'+normalized;
  if(normalized.length===11&&normalized[0]==='7'){
    return '+7 '+normalized.slice(1,4)+' '+normalized.slice(4,7)+'-'+normalized.slice(7,9)+'-'+normalized.slice(9,11);
  }
  return plainText(value);
}

function formatExportMoney(value){
  const number=Number(String(value||0).replace(/\s/g,''));
  if(!number)return '';
  return number.toLocaleString('ru-RU')+' ₽';
}

function csvTextCell(value){
  const text=plainText(value);
  return text?`="${text.replace(/"/g,'""')}"`:'';
}

function exportClientsCsv(kind){
  const isArchive=kind==='archive';
  const source=isArchive?archivedList():clients.filter(c=>!['done','lost'].includes(c.stage));
  const baseHeaders=[
    'name','phone','username','city','category','source','amount','direction','stage','assignedTo',
    'nextTouchDate','lossReason','lossAction','comment','createdAt'
  ];
  const headers=isArchive?[...baseHeaders,'closedAt']:baseHeaders;
  const rows=source.map(c=>({
    name:c.name,
    phone:csvTextCell(formatExportPhone(c.phone)),
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:csvTextCell(formatExportMoney(c.amount)),
    direction:c.direction==='sell'?'USDT -> RUB':'RUB -> USDT',
    stage:c.stage,
    assignedTo:c.assignedTo,
    nextTouchDate:formatExportDate(c.nextTouchDate),
    lossReason:c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    createdAt:formatExportDate(c.createdAt),
    closedAt:formatExportDate(c.closedAt)
  }));
  const csv='\uFEFF'+[
    headers.join(';'),
    ...rows.map(row=>headers.map(header=>['phone','amount'].includes(header)?row[header]:csvEscape(row[header])).join(';'))
  ].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(isArchive?'atom_archive_clients_':'atom_active_clients_')+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportStageLabel(stage){
  return ({active:'В работе',losing:'Клиент сливается',done:'Успешно закрыто',lost:'Потеряно'})[stage]||stage||'';
}

function exportMoneyLabel(value){
  const number=Number(String(value||0).replace(/\s/g,''));
  return number?number.toLocaleString('ru-RU')+' руб.':'';
}

function exportDirectionLabel(direction){
  return direction==='sell'?'USDT -> рубли':'Рубли -> USDT';
}

function exportClientsCsv(kind){
  const isArchive=kind==='archive';
  const source=isArchive?archivedList():clients.filter(c=>!['done','lost'].includes(c.stage));
  const baseColumns=[
    ['name','Имя'],
    ['phone','Телефон'],
    ['username','Username'],
    ['city','Город'],
    ['category','Категория'],
    ['source','Источник'],
    ['amount','Сумма'],
    ['direction','Направление'],
    ['stage','Статус'],
    ['assignedTo','Ответственный'],
    ['nextTouchDate','Следующее касание'],
    ['lossReason','Причина слива'],
    ['lossAction','Следующее действие'],
    ['comment','Комментарий'],
    ['createdAt','Дата создания']
  ];
  const columns=isArchive?[...baseColumns,['closedAt','Дата закрытия']]:baseColumns;
  const rows=source.map(c=>({
    name:c.name,
    phone:csvTextCell(formatExportPhone(c.phone)),
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:csvTextCell(exportMoneyLabel(c.amount)),
    direction:exportDirectionLabel(c.direction),
    stage:exportStageLabel(c.stage),
    assignedTo:CREDENTIALS[c.assignedTo]?.name||c.assignedTo,
    nextTouchDate:formatExportDate(c.nextTouchDate),
    lossReason:LOSS_REASONS[c.lossReason]?.label||c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    createdAt:formatExportDate(c.createdAt),
    closedAt:formatExportDate(c.closedAt)
  }));
  const csv='\uFEFF'+[
    columns.map(([,label])=>label).join(';'),
    ...rows.map(row=>columns.map(([key])=>['phone','amount'].includes(key)?row[key]:csvEscape(row[key])).join(';'))
  ].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(isArchive?'atom_archive_clients_':'atom_active_clients_')+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function cleanLosingColumnTitle(){
  document.querySelectorAll('.live-col-title').forEach(title=>{
    if(title.textContent.trim()==='Клиент сливается / задачи')title.textContent='Клиент сливается';
  });
}

const __cleanLosingRenderCRM=renderCRM;
renderCRM=function(...args){
  __cleanLosingRenderCRM(...args);
  cleanLosingColumnTitle();
};

cleanLosingColumnTitle();

async function sendTelegramDraft(btn){
  const c=clients.find(x=>String(x.id)===String(activeClientId));
  if(!c)return;
  const draft=document.getElementById('tg-draft')?.value.trim()||'';
  if(!draft){
    alert('Введите текст сообщения');
    return;
  }
  const old=btn?.textContent;
  if(btn){btn.textContent='Отправка...';btn.style.pointerEvents='none'}
  try{
    c.telegramChat={
      ...(c.telegramChat||{}),
      title:document.getElementById('tg-client-title')?.value.trim()||c.name,
      username:document.getElementById('tg-client-username')?.value.trim()||c.username||'',
      chatId:document.getElementById('tg-client-chatid')?.value.trim()||'',
      status:'linked'
    };
    c.username=c.telegramChat.username||c.username;
    await syncClientsToBackendNow();
    const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/send-telegram',{
      method:'POST',
      body:JSON.stringify({client:clientPayload(c),text:draft})
    });
    Object.assign(c,normalizeClient({...c,...data.client}));
    __localSave();
    renderTelegramClient(c);
    renderCRM();
    alert('Сообщение отправлено в Telegram');
  }catch(e){
    alert('Не удалось отправить в Telegram: '+e.message);
  }finally{
    if(btn){btn.textContent=old;btn.style.pointerEvents=''}
  }
}

const __sendButtonRenderTelegramClient=renderTelegramClient;
renderTelegramClient=function(c){
  __sendButtonRenderTelegramClient(c);
  const root=document.getElementById('telegram-client-content');
  if(!root||document.getElementById('send-telegram-message'))return;
  const actions=root.querySelector('.quick-actions');
  if(actions){
    actions.insertAdjacentHTML('afterbegin',`<button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>`);
  }
};

const __telegramAutoImports = new Set();

function ensureChatStyles(){
  if(document.getElementById('telegram-chat-style'))return;
  const style=document.createElement('style');
  style.id='telegram-chat-style';
  style.textContent=`
    .tg-chat-list{display:flex;flex-direction:column;gap:8px}
    .tg-bubble-row{display:flex;width:100%}
    .tg-bubble-row.manager{justify-content:flex-end}
    .tg-bubble-row.client{justify-content:flex-start}
    .tg-bubble{max-width:74%;border:1px solid var(--border);border-radius:12px;padding:9px 11px;background:var(--bg3);color:var(--text);font-size:12px;line-height:1.5;white-space:pre-wrap}
    .tg-bubble-row.manager .tg-bubble{background:rgba(76,175,110,.12);border-color:rgba(76,175,110,.28)}
    .tg-bubble-row.client .tg-bubble{background:rgba(91,143,212,.10);border-color:rgba(91,143,212,.24)}
    .tg-bubble-meta{font-size:9px;color:var(--muted);margin-bottom:4px}
    .tg-sync-note{font-size:11px;color:var(--muted);margin-top:8px}
  `;
  document.head.appendChild(style);
}

function renderTelegramBubbles(c){
  const historyCard=[...document.querySelectorAll('#telegram-client-content .card')].find(card=>{
    return (card.querySelector('.card-title')?.textContent||'').includes('История Telegram');
  });
  if(!historyCard)return;
  const messages=(c.telegramMessages||[]).slice(-80);
  historyCard.innerHTML=`<div class="card-title">История Telegram</div>${
    messages.length
      ? `<div class="tg-chat-list">${messages.map(m=>{
          const who=m.sender==='manager'?'manager':'client';
          const label=who==='manager'?'Менеджер':'Клиент';
          const date=esc(String(m.date||'').replace('T',' ').slice(0,16));
          return `<div class="tg-bubble-row ${who}"><div class="tg-bubble"><div class="tg-bubble-meta">${label}${date?' · '+date:''}</div>${esc(m.text||'')}</div></div>`;
        }).join('')}</div>`
      : '<div class="empty-col" id="tg-history-empty">Переписка еще загружается или чат не найден</div>'
  }`;
}

async function autoImportTelegramHistory(c){
  const key=String(c.id||'');
  if(!key||__telegramAutoImports.has(key))return;
  const hasTarget=!!(c.telegramChat?.chatId||c.telegramChat?.username||c.username||c.telegramChat?.title||c.name);
  if(!hasTarget)return;
  __telegramAutoImports.add(key);
  const note=document.querySelector('#telegram-client-content .sync-state');
  if(note)note.textContent='Пробую загрузить переписку из Telegram...';
  try{
    await syncClientsToBackendNow();
    const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
      method:'POST',
      body:JSON.stringify({client:clientPayload(c),historyLimit:100})
    });
    Object.assign(c,normalizeClient({...c,...data.client}));
    __localSave();
    renderTelegramClient(c);
    renderCRM();
  }catch(e){
    if(note)note.textContent='Переписка не загрузилась автоматически: '+e.message;
  }
}

const __chatViewRenderTelegramClient=renderTelegramClient;
renderTelegramClient=function(c){
  ensureChatStyles();
  __chatViewRenderTelegramClient(c);
  const root=document.getElementById('telegram-client-content');
  if(!root)return;
  [...root.querySelectorAll('button')].forEach(button=>{
    if(button.textContent.includes('Привязать чат')||button.textContent.includes('импортировать')){
      button.remove();
    }
  });
  renderTelegramBubbles(c);
  setTimeout(()=>autoImportTelegramHistory(c),150);
};

var __telegramLivePollTimer = null;
var __telegramLivePollBusy = false;

autoImportTelegramHistory=function(){};

function stopTelegramLivePolling(){
  if(__telegramLivePollTimer){
    clearInterval(__telegramLivePollTimer);
    __telegramLivePollTimer=null;
  }
}

function isTelegramPanelOpen(){
  return !!(
    document.querySelector('#client-modal.open') &&
    document.querySelector('#mtab-chat.active') &&
    activeClientId
  );
}

function telegramLiveNote(text){
  const note=document.querySelector('#telegram-client-content .sync-state');
  if(note)note.textContent=text;
}

async function refreshTelegramHistoryLive(c,showStatus){
  if(!c||__telegramLivePollBusy)return;
  const hasTarget=!!(c.telegramChat?.chatId||c.telegramChat?.username||c.username||c.telegramChat?.title||c.name);
  if(!hasTarget)return;
  __telegramLivePollBusy=true;
  if(showStatus)telegramLiveNote('Обновляю переписку из Telegram...');
  try{
    await syncClientsToBackendNow();
    const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
      method:'POST',
      body:JSON.stringify({client:clientPayload(c),historyLimit:100})
    });
    Object.assign(c,normalizeClient({...c,...data.client}));
    __localSave();
    renderTelegramBubbles(c);
    renderCRM();
    telegramLiveNote('Telegram обновляется автоматически каждые 5 секунд.');
  }catch(e){
    console.warn('Telegram auto refresh skipped:', e.message);
  }finally{
    __telegramLivePollBusy=false;
  }
}

function arrangeTelegramPanel(c){
  ensureChatStyles();
  const root=document.getElementById('telegram-client-content');
  if(!root||!c)return;
  const cards=[...root.querySelectorAll('.card')];
  const composeCard=cards.find(card=>(card.querySelector('.card-title')?.textContent||'').includes('Telegram клиента'));
  const historyCard=cards.find(card=>(card.querySelector('.card-title')?.textContent||'').includes('История Telegram'));
  if(historyCard&&composeCard&&historyCard.nextElementSibling!==composeCard){
    root.appendChild(composeCard);
  }
  [...root.querySelectorAll('button')].forEach(button=>{
    const text=button.textContent||'';
    if(text.includes('Привязать чат')||text.includes('импортировать')){
      button.remove();
    }
  });
  const actions=composeCard?.querySelector('.quick-actions');
  if(actions&&!document.getElementById('send-telegram-message')){
    actions.insertAdjacentHTML('afterbegin',`<button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>`);
  }
  renderTelegramBubbles(c);
}

function startTelegramLivePolling(c){
  stopTelegramLivePolling();
  if(!c)return;
  refreshTelegramHistoryLive(c,true);
  __telegramLivePollTimer=setInterval(()=>{
    if(!isTelegramPanelOpen()){
      stopTelegramLivePolling();
      return;
    }
    const current=clients.find(x=>String(x.id)===String(activeClientId));
    refreshTelegramHistoryLive(current,false);
  },5000);
}

sendTelegramDraft=async function(btn){
  const c=clients.find(x=>String(x.id)===String(activeClientId));
  if(!c)return;
  const draft=document.getElementById('tg-draft')?.value.trim()||'';
  if(!draft){
    alert('Введите текст сообщения');
    return;
  }
  const old=btn?.textContent;
  if(btn){btn.textContent='Отправка...';btn.style.pointerEvents='none'}
  try{
    c.telegramChat={
      ...(c.telegramChat||{}),
      title:document.getElementById('tg-client-title')?.value.trim()||c.name,
      username:document.getElementById('tg-client-username')?.value.trim()||c.username||'',
      chatId:document.getElementById('tg-client-chatid')?.value.trim()||'',
      status:'linked'
    };
    c.username=c.telegramChat.username||c.username;
    await syncClientsToBackendNow();
    const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/send-telegram',{
      method:'POST',
      body:JSON.stringify({client:clientPayload(c),text:draft})
    });
    Object.assign(c,normalizeClient({...c,...data.client}));
    __localSave();
    document.getElementById('tg-draft').value='';
    arrangeTelegramPanel(c);
    startTelegramLivePolling(c);
    renderCRM();
    alert('Сообщение отправлено в Telegram');
  }catch(e){
    alert('Не удалось отправить в Telegram: '+e.message);
  }finally{
    if(btn){btn.textContent=old;btn.style.pointerEvents=''}
  }
};

var __livePollRenderTelegramClient=renderTelegramClient;
renderTelegramClient=function(c){
  __livePollRenderTelegramClient(c);
  arrangeTelegramPanel(c);
  if(document.querySelector('#mtab-chat.active')){
    startTelegramLivePolling(c);
  }
};

var __livePollSwitchTab=switchTab;
switchTab=function(id,el){
  if(id!=='chat')stopTelegramLivePolling();
  __livePollSwitchTab(id,el);
};

var __livePollCloseModal=closeModal;
closeModal=function(){
  stopTelegramLivePolling();
  __livePollCloseModal();
};

arrangeTelegramPanel=function(c){
  ensureChatStyles();
  const root=document.getElementById('telegram-client-content');
  if(!root||!c)return;

  const findCard=(title)=>[...root.querySelectorAll('.card')].find(card=>{
    return (card.querySelector('.card-title')?.textContent||'').trim()===title;
  });

  let settingsCard=findCard('Telegram клиента');
  let historyCard=findCard('История Telegram');
  if(!settingsCard||!historyCard)return;

  [...root.querySelectorAll('button')].forEach(button=>{
    const text=button.textContent||'';
    if(text.includes('Привязать чат')||text.includes('импортировать')||text.includes('Google')){
      button.remove();
    }
  });

  let messageCard=root.querySelector('.telegram-message-card');
  if(!messageCard){
    messageCard=document.createElement('div');
    messageCard.className='card telegram-message-card';
    messageCard.innerHTML='<div class="card-title">Сообщение менеджера</div>';
  }

  const oldLabel=settingsCard.querySelector('.msg-lbl');
  const draft=settingsCard.querySelector('#tg-draft');
  const actions=settingsCard.querySelector('.quick-actions');
  if(oldLabel)oldLabel.remove();
  if(draft)messageCard.appendChild(draft);
  if(actions)messageCard.appendChild(actions);

  const messageActions=messageCard.querySelector('.quick-actions');
  if(messageActions&&!document.getElementById('send-telegram-message')){
    messageActions.insertAdjacentHTML('afterbegin',`<button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>`);
  }

  root.insertBefore(settingsCard, root.firstChild);
  if(settingsCard.nextElementSibling!==historyCard){
    root.insertBefore(historyCard, settingsCard.nextElementSibling);
  }
  if(historyCard.nextElementSibling!==messageCard){
    root.insertBefore(messageCard, historyCard.nextElementSibling);
  }

  renderTelegramBubbles(c);

  let note=root.querySelector('.sync-state');
  if(!note){
    note=document.createElement('div');
    note.className='sync-state tg-sync-note';
    settingsCard.appendChild(note);
  }
  if(!note.textContent.trim()){
    note.textContent='Telegram обновляется автоматически каждые 5 секунд.';
  }
};

function dedupeTelegramSendButtons(){
  const root=document.getElementById('telegram-client-content');
  if(!root)return;
  const messageActions=root.querySelector('.telegram-message-card .quick-actions')||root.querySelector('.quick-actions');
  if(!messageActions)return;
  const buttons=[...messageActions.querySelectorAll('button')];
  const sendButtons=buttons.filter(button=>{
    return button.id==='send-telegram-message' ||
      String(button.getAttribute('onclick')||'').includes('sendTelegramDraft') ||
      (button.textContent||'').includes('Отправить');
  });
  sendButtons.forEach((button,index)=>{
    if(index===0){
      button.id='send-telegram-message';
      button.className='btn btn-g';
      button.setAttribute('onclick','sendTelegramDraft(this)');
      button.textContent='Отправить в Telegram';
    }else{
      button.remove();
    }
  });
  if(!messageActions.querySelector('#send-telegram-message')){
    messageActions.insertAdjacentHTML('afterbegin',`<button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>`);
  }
}

var __dedupeArrangeTelegramPanel=arrangeTelegramPanel;
arrangeTelegramPanel=function(c){
  __dedupeArrangeTelegramPanel(c);
  dedupeTelegramSendButtons();
};

authStep1=async function(){
  const login=document.getElementById('auth-login').value.trim().toLowerCase();
  const password=document.getElementById('auth-pass').value;
  const error=document.getElementById('auth-err-1');
  try{
    const data=await backendRequest('/api/login',{
      method:'POST',
      body:JSON.stringify({login,password})
    });
    authToken=data.token;
    sessionStorage.setItem('atom_auth_token',authToken);
    profile=data.profile;
    clearLocalClientsCache();
  }catch(e){
    error.style.display='block';
    error.textContent='Неверный логин или пароль';
    return;
  }
  error.style.display='none';
  saveProfile();
  clients=[];
  __backendLoaded=false;
  await loadClientsFromBackend();
  bootApp();
};

document.addEventListener('DOMContentLoaded',()=>{
  const secondStep=document.getElementById('auth-step-2');
  if(secondStep)secondStep.remove();
});

CREDENTIALS.boss={pass:'',name:'Boss',city:'Все города',role:'Boss / руководитель'};

function isBoss(){
  return profile?.login==='boss' || String(profile?.role||'').toLowerCase().includes('boss');
}

function managerEntries(){
  return Object.entries(CREDENTIALS).filter(([login])=>login!=='boss');
}

function managerName(login){
  return CREDENTIALS[login]?.name || login || 'Не назначен';
}

function visibleClients(){
  if(!Array.isArray(clients))return[];
  return isBoss()?clients:clients.filter(c=>String(c.assignedTo||'')===String(profile?.login||''));
}

function canAccessClient(c){
  return !!c && (isBoss() || String(c.assignedTo||'')===String(profile?.login||''));
}

activeList=function(){
  return visibleClients().filter(c=>c.stage==='active');
};

touchDueList=function(){
  return visibleClients().filter(c=>c.stage==='active'&&c.nextTouchDate&&c.nextTouchDate<=today());
};

losingList=function(){
  return visibleClients().filter(c=>c.stage==='losing');
};

archivedList=function(){
  return visibleClients().filter(c=>c.stage==='done'||c.stage==='lost');
};

function actionLog(){
  try{return JSON.parse(localStorage.getItem('atom_v7_action_log')||'[]')}catch{return[]}
}

function saveActionLog(rows){
  localStorage.setItem('atom_v7_action_log',JSON.stringify(rows.slice(-300)));
}

function logAction(action,client,details=''){
  if(!client)return;
  const rows=actionLog();
  rows.push({
    id:gid(),
    date:new Date().toISOString(),
    manager:profile?.login||'system',
    clientId:client.id,
    clientName:client.name,
    action,
    details
  });
  saveActionLog(rows);
}

function bossLogRows(){
  const stored=actionLog();
  const derived=[];
  (clients||[]).forEach(c=>{
    (c.touches||[]).forEach(t=>derived.push({
      id:'touch-'+c.id+'-'+(t.date||''),
      date:t.date||c.updatedAt||c.createdAt,
      manager:t.manager||c.assignedTo,
      clientName:c.name,
      action:'Касание',
      details:[t.action,t.comment].filter(Boolean).join(' · ')
    }));
    (c.telegramMessages||[]).filter(m=>m.sender==='manager').forEach(m=>derived.push({
      id:'tg-'+c.id+'-'+(m.messageId||m.date||''),
      date:m.date||c.updatedAt||c.createdAt,
      manager:c.assignedTo,
      clientName:c.name,
      action:'Telegram',
      details:String(m.text||'').slice(0,90)
    }));
  });
  return [...stored,...derived]
    .filter(Boolean)
    .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
    .slice(0,60);
}

function accessNotice(){
  return isBoss()
    ? 'Boss видит всех клиентов, общий оборот, статистику менеджеров и журнал действий.'
    : 'Менеджер видит только клиентов, назначенных на его аккаунт.';
}

const __roleBootApp=bootApp;
bootApp=function(){
  __roleBootApp();
  document.querySelectorAll('.auth-hint').forEach(el=>{ el.textContent=''; });
};

const __roleOpenClient=openClient;
openClient=function(id){
  const c=(clients||[]).find(x=>String(x.id)===String(id));
  if(!canAccessClient(c)){
    alert('Нет доступа к этому клиенту. Он назначен другому менеджеру.');
    return;
  }
  __roleOpenClient(id);
};

const __roleCreateClient=createClient;
createClient=function(){
  const before=new Set((clients||[]).map(c=>String(c.id)));
  __roleCreateClient();
  const created=(clients||[]).find(c=>!before.has(String(c.id)));
  if(created)logAction('Создал клиента',created,`Ответственный: ${managerName(created.assignedTo)}`);
};

const __roleSaveInfo=saveInfo;
saveInfo=function(e){
  const c=(clients||[]).find(x=>String(x.id)===String(activeClientId));
  __roleSaveInfo(e);
  if(c)logAction('Обновил карточку',c,'Изменены данные клиента');
};

const __roleSaveTouch=saveTouch;
saveTouch=function(){
  const c=(clients||[]).find(x=>String(x.id)===String(activeClientId));
  __roleSaveTouch();
  if(c)logAction('Сохранил касание',c,document.getElementById('touch-comment')?.value.trim()||'');
};

const __roleToggleSOP=toggleSOP;
toggleSOP=function(i){
  const c=(clients||[]).find(x=>String(x.id)===String(activeClientId));
  __roleToggleSOP(i);
  if(c)logAction('Обновил чек-лист',c,`Пункт ${Number(i)+1}`);
};

const __roleSendTelegramDraft=sendTelegramDraft;
sendTelegramDraft=async function(btn){
  const c=(clients||[]).find(x=>String(x.id)===String(activeClientId));
  const text=document.getElementById('tg-draft')?.value.trim()||'';
  await __roleSendTelegramDraft(btn);
  if(c&&text)logAction('Отправил Telegram',c,text.slice(0,90));
};

renderCRM=function(){
  const board=document.getElementById('crm-board');
  if(!board)return;
  normalizeAll();
  const q=(document.getElementById('crm-search')?.value||'').toLowerCase();
  const city=document.getElementById('filter-city')?.value||'';
  const source=visibleClients();
  const filt=c=>(!city||c.city===city)&&(!q||[
    c.name,c.phone,c.username,c.city,c.source,c.category,c.assignedTo,managerName(c.assignedTo)
  ].join(' ').toLowerCase().includes(q));
  const dueIds=new Set(touchDueList().map(c=>c.id));
  const active=activeList().filter(c=>!dueIds.has(c.id)).filter(filt).sort((a,b)=>ageMin(b)-ageMin(a));
  const touch=touchDueList().filter(filt).sort((a,b)=>(a.nextTouchDate||'').localeCompare(b.nextTouchDate||''));
  const losing=losingList().filter(filt).sort((a,b)=>(a.followUpDate||'').localeCompare(b.followUpDate||''));
  const done=source.filter(c=>c.stage==='done').filter(filt).slice(0,12);
  const liveRub=source.filter(c=>!['done','lost'].includes(c.stage)).reduce((s,c)=>s+Number(c.amount||0),0);
  document.getElementById('live-money-box').innerHTML=`<div class="live-money-main">${fmt(liveRub)} ₽</div><div class="live-money-sub">${accessNotice()} · ${activeList().length} активных · ${touch.length} ждут касания · ${losing.length} на дожиме</div>`;
  board.innerHTML=`${col('В работе',active)}${col('Касания',touch,true)}${col('Клиент сливается',losing,true)}${col('Завершено',done)}`;
  const badge=document.getElementById('remind-badge');
  if(badge){badge.style.display='none';badge.textContent='0'}
};

function bossManagerStats(){
  return managerEntries().map(([login,u])=>{
    const list=(clients||[]).filter(c=>c.assignedTo===login);
    const active=list.filter(c=>c.stage==='active');
    const losing=list.filter(c=>c.stage==='losing');
    const done=list.filter(c=>c.stage==='done');
    const lost=list.filter(c=>c.stage==='lost');
    const money=list.filter(c=>!['lost'].includes(c.stage)).reduce((s,c)=>s+Number(c.amount||0),0);
    return{login,...u,total:list.length,active:active.length,losing:losing.length,done:done.length,lost:lost.length,money};
  });
}

function managerClientTable(list){
  return `<div class="chat-list">${list.slice(0,18).map(c=>`<div class="chat-item" data-onclick="openClient('${c.id}')"><div><b>${esc(c.name)}</b><div class="archive-meta">${esc(c.city)} · ${esc(c.stage)} · ${esc(managerName(c.assignedTo))}</div></div><span class="contact-pill">${c.amount?fmt(c.amount)+' ₽':'без суммы'}</span></div>`).join('')||'<div class="empty-col">Клиентов нет</div>'}</div>`;
}

function bossCabinet(){
  const root=document.getElementById('cabinet-content');
  const all=clients||[];
  const active=all.filter(c=>c.stage==='active');
  const losing=all.filter(c=>c.stage==='losing');
  const done=all.filter(c=>c.stage==='done');
  const lost=all.filter(c=>c.stage==='lost');
  const openMoney=all.filter(c=>!['done','lost'].includes(c.stage)).reduce((s,c)=>s+Number(c.amount||0),0);
  const closedMoney=done.reduce((s,c)=>s+Number(c.amount||0),0);
  const stats=bossManagerStats();
  const log=bossLogRows();
  root.innerHTML=`<div class="card"><div class="card-title">Boss кабинет</div><div class="cab-person"><div class="cab-avatar">B</div><div><div class="md-title">Boss</div><div class="archive-meta">Главный аккаунт · видит всех клиентов, статистику и журнал действий</div></div></div></div>
  <div class="dash-mini-grid" style="grid-template-columns:repeat(6,1fr)">
    ${metric('Всего клиентов',all.length,'в базе',100)}
    ${metric('В работе',active.length,'активные',all.length?active.length/all.length*100:0)}
    ${metric('Клиент сливается',losing.length,'на дожиме',all.length?losing.length/all.length*100:0)}
    ${metric('Завершено',done.length,'успешные',all.length?done.length/all.length*100:0)}
    ${metric('Потеряно',lost.length,'архив потерь',all.length?lost.length/all.length*100:0)}
    ${metric('Открытый объем',(openMoney/1e6).toFixed(1)+'M ₽','в работе',72)}
  </div>
  <div class="cab-grid">
    <div class="card"><div class="card-title">Статистика менеджеров</div>${stats.map(s=>`<div class="chat-item"><div><b>${esc(s.name)}</b><div class="archive-meta">${esc(s.city)} · клиентов ${s.total} · в работе ${s.active} · сливается ${s.losing} · закрыто ${s.done}</div></div><span class="contact-pill">${fmt(s.money)} ₽</span></div>`).join('')}</div>
    <div class="card"><div class="card-title">Финансы</div>${metric('Закрытый оборот',(closedMoney/1e6).toFixed(1)+'M ₽','успешно закрыто',80)}${metric('Открытый объем',(openMoney/1e6).toFixed(1)+'M ₽','активные и дожим',70)}</div>
  </div>
  <div class="cab-grid">
    <div class="card"><div class="card-title">Журнал действий</div><div class="chat-list">${log.map(row=>`<div class="chat-item"><div><b>${esc(row.action)}</b><div class="archive-meta">${esc(managerName(row.manager))} · ${esc(row.clientName||'')} · ${esc(String(row.date||'').replace('T',' ').slice(0,16))}</div><div class="archive-meta">${esc(row.details||'')}</div></div></div>`).join('')||'<div class="empty-col">Журнал пока пуст</div>'}</div></div>
    <div class="card"><div class="card-title">Все клиенты</div>${managerClientTable(all.sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''))))}</div>
  </div>`;
}

function managerCabinet(){
  const root=document.getElementById('cabinet-content');
  const mine=visibleClients();
  const active=mine.filter(c=>c.stage==='active');
  const losing=mine.filter(c=>c.stage==='losing');
  const archive=mine.filter(c=>c.stage==='done'||c.stage==='lost');
  const role=profile?.role||CREDENTIALS[profile?.login]?.role||'CRM';
  root.innerHTML=`<div class="cab-grid">
    <div class="card"><div class="card-title">Личный кабинет</div><div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(role)} · ${esc(profile?.city||'')} · login: ${esc(profile?.login||'')}</div></div></div><hr><div class="dash-mini-grid" style="grid-template-columns:repeat(3,1fr)">${metric('Мои клиенты',mine.length,'назначены мне',100)}${metric('В работе',active.length,'активные',mine.length?active.length/mine.length*100:0)}${metric('Архив',archive.length,'закрытые',mine.length?archive.length/mine.length*100:0)}</div></div>
    <div class="card"><div class="card-title">Состав кабинетов</div>${managerEntries().map(([login,u])=>`<div class="chat-item"><div><b>${esc(u.name)}</b><div class="archive-meta">${esc(u.role)} · ${esc(u.city)}</div></div><span class="contact-pill">${login}</span></div>`).join('')}</div>
  </div>
  <div class="cab-grid">
    <div class="card"><div class="card-title">Мои активные клиенты</div>${managerClientTable([...active,...losing])}</div>
    <div class="card"><div class="card-title">Мой журнал действий</div><div class="chat-list">${bossLogRows().filter(row=>String(row.manager)===String(profile?.login)).slice(0,30).map(row=>`<div class="chat-item"><div><b>${esc(row.action)}</b><div class="archive-meta">${esc(row.clientName||'')} · ${esc(String(row.date||'').replace('T',' ').slice(0,16))}</div><div class="archive-meta">${esc(row.details||'')}</div></div></div>`).join('')||'<div class="empty-col">Журнал пока пуст</div>'}</div></div>
  </div>`;
}

renderCabinet=function(){
  const root=document.getElementById('cabinet-content');
  if(!root)return;
  if(isBoss())bossCabinet();
  else managerCabinet();
};

filterArchive=function(){
  const q=(document.getElementById('archive-search')?.value||'').toLowerCase();
  const st=document.getElementById('archive-status')?.value||'';
  const city=document.getElementById('archive-city')?.value||'';
  const reason=document.getElementById('archive-reason')?.value||'';
  const source=document.getElementById('archive-source')?.value||'';
  const list=archivedList().filter(c=>(!st||c.stage===st)&&(!city||c.city===city)&&(!reason||c.lossReason===reason)&&(!source||c.source===source)&&(!q||[c.name,c.phone,c.username,c.city,c.source,c.lossComment,c.assignedTo,managerName(c.assignedTo)].join(' ').toLowerCase().includes(q))).sort((a,b)=>new Date(b.closedAt||b.createdAt)-new Date(a.closedAt||a.createdAt));
  const done=list.filter(c=>c.stage==='done');
  const lost=list.filter(c=>c.stage==='lost');
  const rub=done.reduce((s,c)=>s+Number(c.amount||0),0);
  document.getElementById('archive-summary').innerHTML=`<div class="dash-mini-grid" style="grid-template-columns:repeat(4,1fr)">${metric('В архиве',list.length,'доступные сделки',100)}${metric('Успешно',done.length,'закрытые',list.length?done.length/list.length*100:0)}${metric('Потеряно',lost.length,'потери',list.length?lost.length/list.length*100:0)}${metric('Оборот',(rub/1e6).toFixed(1)+'M ₽','успешные сделки',72)}</div>`;
  document.getElementById('archive-list').innerHTML=list.map(c=>`<div class="archive-card ${c.stage}" data-onclick="openClient('${c.id}')"><div class="archive-top"><div><div class="archive-name">${esc(c.name)}</div><div class="archive-meta">${c.city} · ${c.source} · ${managerName(c.assignedTo)}</div></div><span class="archive-status ${c.stage}">${c.stage==='done'?'Успешно':'Потеряно'}</span></div><div class="archive-money">${c.amount?fmt(c.amount)+' ₽':'сумма не указана'}</div><div class="contact-mini">${c.phone?`<span class="contact-pill">${esc(c.phone)}</span>`:''}${c.username?`<span class="contact-pill">${esc(c.username)}</span>`:''}${c.lossReason?`<span class="contact-pill red">${LOSS_REASONS[c.lossReason]?.label}</span>`:''}</div>${c.stage==='lost'?`<div class="archive-meta">Касание: ${c.followUpDate||'не назначено'} · ${esc(c.lossAction||'действие не выбрано')}</div>`:''}</div>`).join('')||'<div class="empty-col">В архиве пусто</div>';
};

exportClientsCsv=function(kind){
  const isArchive=kind==='archive';
  const source=isArchive?archivedList():visibleClients().filter(c=>!['done','lost'].includes(c.stage));
  const columns=[
    ['name','Имя'],['phone','Телефон'],['username','Username'],['city','Город'],['category','Категория'],['source','Источник'],['amount','Сумма'],['direction','Направление'],['stage','Статус'],['assignedTo','Ответственный'],['nextTouchDate','Следующее касание'],['lossReason','Причина слива'],['lossAction','Следующее действие'],['comment','Комментарий'],['createdAt','Дата создания']
  ];
  if(isArchive)columns.push(['closedAt','Дата закрытия']);
  const rows=source.map(c=>({
    name:c.name,
    phone:csvTextCell(formatExportPhone(c.phone)),
    username:c.username,
    city:c.city,
    category:c.category,
    source:c.source,
    amount:csvTextCell(exportMoneyLabel(c.amount)),
    direction:exportDirectionLabel(c.direction),
    stage:exportStageLabel(c.stage),
    assignedTo:managerName(c.assignedTo),
    nextTouchDate:formatExportDate(c.nextTouchDate),
    lossReason:LOSS_REASONS[c.lossReason]?.label||c.lossReason,
    lossAction:c.lossAction,
    comment:c.comment,
    createdAt:formatExportDate(c.createdAt),
    closedAt:formatExportDate(c.closedAt)
  }));
  const csv='\uFEFF'+[columns.map(([,label])=>label).join(';'),...rows.map(row=>columns.map(([key])=>['phone','amount'].includes(key)?row[key]:csvEscape(row[key])).join(';'))].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(isArchive?'atom_archive_clients_':'atom_active_clients_')+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.auth-hint').forEach(el=>{
    el.textContent='';
  });
});

const __secureLogout=logout;
logout=function(){
  authToken='';
  sessionStorage.removeItem('atom_auth_token');
  fetch(SRM_API_BASE+'/api/logout',{method:'POST',keepalive:true}).catch(()=>{});
  __secureLogout();
};

(() => {
  const style=document.createElement('style');
  style.textContent=`
    .atom-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--bg3)}
    .atom-table{width:100%;border-collapse:collapse;min-width:860px;font-size:11px}
    .atom-table th{position:sticky;top:0;background:rgba(20,20,20,.96);color:var(--gold);font-size:9px;text-transform:uppercase;letter-spacing:.08em;text-align:left;padding:10px;border-bottom:1px solid var(--border)}
    .atom-table td{padding:10px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}
    .atom-table tr{cursor:pointer}
    .atom-table tbody tr:hover{background:rgba(201,168,76,.07)}
    .atom-table tbody tr:last-child td{border-bottom:0}
    .archive-status,.atom-status-badge{display:inline-flex;align-items:center;justify-content:center;min-width:92px;height:30px;padding:0 12px;border-radius:999px;font-size:10px;font-weight:700;line-height:1;white-space:nowrap}
    .archive-status.done,.atom-status-badge.done{background:rgba(76,175,110,.14);border:1px solid rgba(76,175,110,.28);color:var(--green)}
    .archive-status.lost,.atom-status-badge.lost{background:rgba(224,85,85,.14);border:1px solid rgba(224,85,85,.28);color:var(--red)}
    .atom-status-badge.active{background:rgba(91,143,212,.14);border:1px solid rgba(91,143,212,.28);color:var(--blue)}
    .atom-status-badge.losing{background:rgba(201,168,76,.14);border:1px solid rgba(201,168,76,.28);color:var(--gold)}
  `;
  document.head.appendChild(style);
})();
let atomUsers=[];
let atomAuditLogs=[];
let atomTelegramSettings=[];
let atomWarpStatus=null;
let atomPanelLoading=false;

function syncCredentialsFromUsers(users){
  (users||[]).forEach(u=>{
    if(!u||!u.login)return;
    CREDENTIALS[u.login]={
      pass:CREDENTIALS[u.login]?.pass||'',
      name:u.name||u.login,
      city:u.city||'',
      role:u.role||'CRM / менеджер'
    };
  });
}

async function loadControlPanelData(){
  if(!authToken||atomPanelLoading)return;
  atomPanelLoading=true;
  try{
    const [audit,tg,warp]=await Promise.all([
      backendRequest('/api/audit-log').catch(()=>({logs:[]})),
      backendRequest('/api/telegram-settings').catch(()=>({settings:[]})),
      backendRequest('/api/vps/warp').catch(()=>({warp:null}))
    ]);
    atomAuditLogs=audit.logs||[];
    atomTelegramSettings=tg.settings||[];
    atomWarpStatus=warp.warp||null;
    if(isBoss()){
      const users=await backendRequest('/api/users').catch(()=>({users:[]}));
      atomUsers=users.users||[];
      syncCredentialsFromUsers(atomUsers);
    }else{
      atomUsers=[profile].filter(Boolean);
      syncCredentialsFromUsers(atomUsers);
    }
  }finally{
    atomPanelLoading=false;
  }
}

const __atomBootApp=bootApp;
bootApp=function(){
  __atomBootApp();
  loadControlPanelData().then(()=>{
    renderCRM();
    renderCabinet();
  }).catch(()=>{});
};

const __atomShowPage=showPage;
showPage=function(id,el){
  __atomShowPage(id,el);
  if(id==='cabinet'){
    loadControlPanelData().then(renderCabinet).catch(()=>{});
  }
};

function stageRu(stage){
  return ({active:'В работе',losing:'Клиент сливается',done:'Завершено',lost:'Потеряно'}[stage]||stage||'');
}

function statusRu(settings){
  return settings?.telegramSessionStatus==='configured'?'Подключена':'Не подключена';
}

function telegramStatusPanel(settings){
  const connected=settings?.telegramSessionStatus==='configured';
  return `<div class="tg-status-panel ${connected?'ok':'bad'}">
    <div class="tg-status-dot"></div>
    <div><b>${connected?'Telegram подключен':'Telegram не подключен'}</b><span>${connected?'Сессия активна, CRM может отправлять и подтягивать переписку.':'Введите номер, отправьте код и подключите аккаунт Telegram.'}</span></div>
  </div>`;
}

function crmMoney(value){
  return Number(value||0).toLocaleString('ru-RU')+' ₽';
}

function visibleForStats(){
  return isBoss()?clients:visibleClients();
}

function managerRows(){
  const users=(atomUsers.length?atomUsers:Object.entries(CREDENTIALS).map(([login,u])=>({login,...u})))
    .filter(u=>u.login&&u.login!=='boss');
  return users.map(u=>{
    const list=(clients||[]).filter(c=>String(c.assignedTo||'')===String(u.login));
    const active=list.filter(c=>c.stage==='active').length;
    const losing=list.filter(c=>c.stage==='losing').length;
    const done=list.filter(c=>c.stage==='done').length;
    const lost=list.filter(c=>c.stage==='lost').length;
    const amount=list.filter(c=>c.stage!=='lost').reduce((s,c)=>s+Number(c.amount||0),0);
    return {...u,total:list.length,active,losing,done,lost,amount};
  });
}

function analyticsHtml(list){
  const active=list.filter(c=>c.stage==='active');
  const losing=list.filter(c=>c.stage==='losing');
  const done=list.filter(c=>c.stage==='done');
  const lost=list.filter(c=>c.stage==='lost');
  const openAmount=[...active,...losing].reduce((s,c)=>s+Number(c.amount||0),0);
  const closedAmount=done.reduce((s,c)=>s+Number(c.amount||0),0);
  const avg=list.length?Math.round(list.reduce((s,c)=>s+Number(c.amount||0),0)/list.length):0;
  const conversion=(done.length+lost.length)?Math.round(done.length/(done.length+lost.length)*100):0;
  const tgSent=list.reduce((s,c)=>s+(c.telegramMessages||[]).filter(m=>m.sender==='manager').length,0);
  return `<div class="dash-mini-grid" style="grid-template-columns:repeat(6,1fr)">
    ${metric('Клиенты',list.length,'в доступе',100)}
    ${metric('Активные',active.length,'в работе',list.length?active.length/list.length*100:0)}
    ${metric('Дожим',losing.length,'клиент сливается',list.length?losing.length/list.length*100:0)}
    ${metric('Конверсия',conversion+'%','done / done+lost',conversion)}
    ${metric('Открытый объем',crmMoney(openAmount),'активные + дожим',70)}
    ${metric('Средний чек',crmMoney(avg),'по базе',60)}
  </div>
  <div class="dash-mini-grid" style="grid-template-columns:repeat(3,1fr)">
    ${metric('Закрытый оборот',crmMoney(closedAmount),'успешные сделки',80)}
    ${metric('Касания',touchDueList().filter(c=>isBoss()||c.assignedTo===profile?.login).length,'сегодня/просрочено',60)}
    ${metric('Telegram',tgSent,'сообщений менеджера',50)}
  </div>`;
}

function clientsTableHtml(list){
  const rows=list.slice().sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  return `<div class="atom-table-wrap"><table class="atom-table">
    <thead><tr><th>Клиент</th><th>Телефон</th><th>Город</th><th>Сумма</th><th>Статус</th><th>Ответственный</th><th>Касание</th></tr></thead>
    <tbody>${rows.map(c=>`<tr data-onclick="openClient('${c.id}')"><td><b>${esc(c.name)}</b><div class="archive-meta">${esc(c.username||'')}</div></td><td>${esc(formatExportPhone?formatExportPhone(c.phone):c.phone||'')}</td><td>${esc(c.city||'')}</td><td>${crmMoney(c.amount)}</td><td><span class="atom-status-badge ${esc(c.stage||'active')}">${stageRu(c.stage)}</span></td><td>${esc(managerName(c.assignedTo))}</td><td>${esc(formatExportDate?formatExportDate(c.nextTouchDate):c.nextTouchDate||'')}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function managerSelectOptions(selected){
  return managerRows().map(u=>`<option value="${esc(u.login)}" ${u.login===selected?'selected':''}>${esc(u.name)} (${esc(u.login)})</option>`).join('');
}

function bossUsersHtml(){
  return `<div class="card"><div class="card-title">Управление учетками</div>
    <div class="fg3" style="margin-bottom:10px">
      <div><div class="fl">Логин</div><input class="fi" id="adm-login" placeholder="manager_login"></div>
      <div><div class="fl">Имя</div><input class="fi" id="adm-name" placeholder="Имя менеджера"></div>
      <div><div class="fl">Пароль</div><input class="fi" id="adm-pass" type="password" placeholder="минимум 4 символа"></div>
    </div>
    <div class="fg2">
      <div><div class="fl">Город</div><input class="fi" id="adm-city" placeholder="Уфа"></div>
      <div><div class="fl">Роль</div><input class="fi" id="adm-role" value="CRM / менеджер"></div>
    </div>
    <div class="quick-actions"><button class="btn btn-g" data-onclick="saveManagedUser()">Создать / обновить</button></div>
    <div class="chat-list" style="margin-top:12px">${managerRows().map(u=>`<div class="chat-item"><div><b>${esc(u.name)}</b><div class="archive-meta">${esc(u.role)} · ${esc(u.city)} · login: ${esc(u.login)}</div><div class="archive-meta">Клиентов: ${u.total} · В работе: ${u.active} · Дожим: ${u.losing} · Закрыто: ${u.done}</div></div><div class="quick-actions" style="margin-top:0"><button class="btn btn-b btn-xs" data-onclick="fillManagedUser('${u.login}')">Изменить</button><button class="btn btn-b btn-xs" data-onclick="changeUserPassword('${u.login}')">Пароль</button><button class="btn btn-r btn-xs" data-onclick="deleteManagedUser('${u.login}')">Удалить</button></div></div>`).join('')}</div>
  </div>`;
}

function telegramSettingsCard(login){
  const settings=atomTelegramSettings.find(s=>s.managerLogin===login)||{managerLogin:login,telegramAccount:'',telegramSessionStatus:'not_configured',telegramSessionHint:''};
  const canEdit=login===profile?.login;
  return `<div class="card"><div class="card-title">Telegram подключение: ${esc(managerName(login))}</div>
    ${telegramStatusPanel(settings)}
    <div class="fg2">
      <div><div class="fl">Аккаунт Telegram</div><input class="fi" id="tgset-account-${esc(login)}" value="${esc(settings.telegramAccount||'')}" placeholder="@manager или +7900..."></div>
      <div><div class="fl">Телефон для входа</div><input class="fi" id="tglogin-phone-${esc(login)}" placeholder="+79001234567"></div>
    </div>
    <div class="fg2" style="margin-top:10px">
      <div><div class="fl">Код из Telegram</div><input class="fi" id="tglogin-code-${esc(login)}" placeholder="12345"></div>
      <div><div class="fl">Пароль 2FA, если есть</div><input class="fi" id="tglogin-password-${esc(login)}" type="password" placeholder="не обязательно"></div>
    </div>
    <input type="hidden" id="tglogin-flow-${esc(login)}">
    <div class="sync-state" id="tglogin-state-${esc(login)}">Статус: ${statusRu(settings)}${settings.telegramSessionHint?' · '+esc(settings.telegramSessionHint):''}. CRM ищет чат клиента по username или chat id в карточке клиента. Если персональная сессия не подключена, backend использует общую серверную сессию.</div>
    ${canEdit?`<div class="quick-actions"><button class="btn btn-b" data-onclick="saveTelegramSettings('${login}')">Сохранить подпись</button><button class="btn btn-g" data-onclick="startTelegramAuth('${login}')">Отправить код</button><button class="btn" data-onclick="completeTelegramAuth('${login}')">Подключить по коду</button><button class="btn btn-r" data-onclick="disconnectTelegramSession('${login}')">Отвязать Telegram</button></div>`:''}
  </div>`;
}

function auditHtml(){
  const logs=(atomAuditLogs.length?atomAuditLogs:bossLogRows())
    .filter(row=>!String(row.action||'').includes('Синхронизировал клиентов'))
    .slice(0,80);
  return `<div class="card"><div class="card-title">Журнал действий</div><div class="chat-list">${logs.map(row=>`<div class="chat-item"><div><b>${esc(row.action||'Действие')}</b><div class="archive-meta">${esc(managerName(row.managerLogin||row.manager))} · ${esc(row.clientName||'')} · ${esc(String(row.createdAt||row.date||'').replace('T',' ').slice(0,16))}</div><div class="archive-meta">${esc(row.details||'')}</div></div></div>`).join('')||'<div class="empty-col">Журнал пока пуст</div>'}</div></div>`;
}

renderCabinet=function(){
  const root=document.getElementById('cabinet-content');
  if(!root)return;
  const list=visibleForStats();
  if(isBoss()){
    root.innerHTML=`<div class="card"><div class="card-title">Boss кабинет</div><p>Boss видит всех клиентов, аналитику, журнал действий и может управлять учетками менеджеров.</p></div>
      ${warpStatusHtml()}
      ${analyticsHtml(list)}
      <div class="cab-grid"><div>${bossUsersHtml()}</div><div>${telegramSettingsCard('boss')}</div></div>
      <div class="card"><div class="card-title">Клиенты в CRM</div>${clientsTableHtml(list)}</div>
      ${auditHtml()}`;
  }else{
    root.innerHTML=`<div class="card"><div class="card-title">Личный кабинет</div><div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(profile?.role||'CRM / менеджер')} · ${esc(profile?.city||'')} · login: ${esc(profile?.login||'')}</div></div></div></div>
      ${warpStatusHtml()}
      ${analyticsHtml(list)}
      ${telegramSettingsCard(profile?.login)}
      <div class="card"><div class="card-title">Мои клиенты</div>${clientsTableHtml(list)}</div>
      ${auditHtml()}`;
  }
};

async function saveManagedUser(){
  const payload={
    login:document.getElementById('adm-login')?.value.trim().toLowerCase(),
    name:document.getElementById('adm-name')?.value.trim(),
    city:document.getElementById('adm-city')?.value.trim()||'',
    role:document.getElementById('adm-role')?.value.trim()||'CRM / менеджер',
    password:document.getElementById('adm-pass')?.value||''
  };
  if(!payload.login||!payload.name){alert('Заполни логин и имя');return}
  await backendRequest('/api/users',{method:'POST',body:JSON.stringify(payload)});
  await loadControlPanelData();
  renderCabinet();
}

function fillManagedUser(login){
  const u=managerRows().find(x=>x.login===login);
  if(!u)return;
  document.getElementById('adm-login').value=u.login;
  document.getElementById('adm-name').value=u.name||'';
  document.getElementById('adm-city').value=u.city||'';
  document.getElementById('adm-role').value=u.role||'CRM / менеджер';
  document.getElementById('adm-pass').value='';
}

async function changeUserPassword(login){
  const password=prompt('Новый пароль для '+login+':');
  if(!password)return;
  await backendRequest('/api/users/'+encodeURIComponent(login)+'/password',{method:'PATCH',body:JSON.stringify({password})});
  alert('Пароль изменен');
}

async function deleteManagedUser(login){
  if(!confirm('Удалить учетку '+login+'? Клиенты останутся в базе, но лучше сначала переназначить их.'))return;
  await backendRequest('/api/users/'+encodeURIComponent(login),{method:'DELETE'});
  delete CREDENTIALS[login];
  await loadControlPanelData();
  renderCabinet();
}

async function saveTelegramSettings(login){
  const body={
    telegramAccount:document.getElementById('tgset-account-'+login)?.value.trim()||'',
    telegramSession:''
  };
  await backendRequest('/api/telegram-settings/'+encodeURIComponent(login),{method:'PUT',body:JSON.stringify(body)});
  await loadControlPanelData();
  renderCabinet();
  alert('Telegram подпись сохранена');
}

async function startTelegramAuth(login){
  const state=document.getElementById('tglogin-state-'+login);
  const phone=document.getElementById('tglogin-phone-'+login)?.value.trim();
  if(!phone){alert('Введи номер Telegram');return}
  try{
    if(state)state.textContent='Отправляю код в Telegram...';
    const data=await backendRequest('/api/telegram-auth/'+encodeURIComponent(login)+'/start',{
      method:'POST',
      body:JSON.stringify({phone})
    });
    document.getElementById('tglogin-flow-'+login).value=data.flowId;
    if(state)state.textContent='Код отправлен '+(data.isCodeViaApp?'в приложение Telegram':'по SMS')+'. Введи код и нажми "Подключить по коду".';
  }catch(e){
    if(state)state.textContent='Ошибка Telegram: '+e.message;
    alert('Ошибка Telegram: '+e.message);
  }
}

async function completeTelegramAuth(login){
  const state=document.getElementById('tglogin-state-'+login);
  const flowId=document.getElementById('tglogin-flow-'+login)?.value;
  const code=document.getElementById('tglogin-code-'+login)?.value.trim();
  const password=document.getElementById('tglogin-password-'+login)?.value;
  if(!flowId){alert('Сначала нажми "Отправить код"');return}
  if(!code&&!password){alert('Введи код из Telegram');return}
  try{
    if(state)state.textContent='Проверяю код Telegram...';
    const data=await backendRequest('/api/telegram-auth/'+encodeURIComponent(login)+'/complete',{
      method:'POST',
      body:JSON.stringify({flowId,code,password})
    });
    if(data.needsPassword){
      if(state)state.textContent='Telegram просит пароль 2FA. Введи пароль и снова нажми "Подключить по коду".';
      return;
    }
    await loadControlPanelData();
    renderCabinet();
    alert('Telegram подключен к учетке '+login);
  }catch(e){
    if(state)state.textContent='Ошибка Telegram: '+e.message;
    alert('Ошибка Telegram: '+e.message);
  }
}

async function disconnectTelegramSession(login){
  if(!confirm('Отвязать Telegram-сессию от учетки '+login+'? Потом можно подключить другой аккаунт через номер и код.'))return;
  const state=document.getElementById('tglogin-state-'+login);
  try{
    if(state)state.textContent='Отвязываю Telegram...';
    await backendRequest('/api/telegram-settings/'+encodeURIComponent(login)+'/session',{method:'DELETE'});
    await loadControlPanelData();
    renderCabinet();
    alert('Telegram отвязан от учетки '+login);
  }catch(e){
    if(state)state.textContent='Ошибка Telegram: '+e.message;
    alert('Ошибка Telegram: '+e.message);
  }
}

const __atomLoadInfo=loadInfo;
loadInfo=function(c){
  __atomLoadInfo(c);
  const tab=document.getElementById('mtab-info');
  if(tab&&isBoss()&&!document.getElementById('mi-assigned-to')){
    tab.insertAdjacentHTML('beforeend',`<div style="margin-top:10px"><div class="fl">Ответственный менеджер</div><select class="fs" id="mi-assigned-to">${managerSelectOptions(c.assignedTo)}</select></div>`);
  }
};

const __atomSaveInfo=saveInfo;
saveInfo=function(e){
  const c=clients.find(x=>String(x.id)===String(activeClientId));
  if(c&&isBoss()){
    const next=document.getElementById('mi-assigned-to')?.value;
    if(next)c.assignedTo=next;
  }
  __atomSaveInfo(e);
};

const __atomLogAction=logAction;
logAction=function(action,client,details=''){
  __atomLogAction(action,client,details);
  if(authToken){
    backendRequest('/api/audit-log',{method:'POST',body:JSON.stringify({
      clientId:client?.id||'',
      clientName:client?.name||'',
      action,
      details
    })}).then(loadControlPanelData).catch(()=>{});
  }
};

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.auth-hint').forEach(el=>{el.textContent='';});
});

const __atomTelegramTextRender=renderTelegramClient;
renderTelegramClient=function(c){
  __atomTelegramTextRender(c);
  const state=document.querySelector('#telegram-client-content .sync-state');
  if(state)state.textContent='Backend импортирует историю выбранного Telegram-чата по username или chat id и сохраняет ее в базу. Если у менеджера подключена своя Telegram-сессия, используется она; иначе общая серверная сессия.';
};

(() => {
  const style=document.createElement('style');
  style.textContent=`
    .atom-toast-wrap{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 36px))}
    .atom-toast{background:rgba(26,26,26,.96);border:1px solid var(--border);border-left:3px solid var(--gold);box-shadow:0 14px 40px rgba(0,0,0,.35);border-radius:10px;padding:11px 13px;color:var(--text);font-size:12px;line-height:1.45;opacity:0;transform:translateY(8px);transition:.18s ease}
    .atom-toast.show{opacity:1;transform:translateY(0)}
    .atom-toast.ok{border-left-color:var(--green)}
    .atom-toast.err{border-left-color:var(--red)}
  `;
  document.head.appendChild(style);
  function toast(message,type='ok'){
    let wrap=document.querySelector('.atom-toast-wrap');
    if(!wrap){
      wrap=document.createElement('div');
      wrap.className='atom-toast-wrap';
      document.body.appendChild(wrap);
    }
    const item=document.createElement('div');
    const text=String(message||'');
    item.className='atom-toast '+(text.toLowerCase().includes('ошибка')||text.toLowerCase().includes('error')||text.toLowerCase().includes('не удалось')?'err':type);
    item.textContent=text;
    wrap.appendChild(item);
    requestAnimationFrame(()=>item.classList.add('show'));
    setTimeout(()=>item.classList.remove('show'),2600);
    setTimeout(()=>item.remove(),3000);
  }
  window.atomToast=toast;
  window.alert=(message)=>toast(message);
})();

(() => {
  function sidebarItemByPage(page){
    return [...document.querySelectorAll('.sb-nav .sb-item')]
      .find(item => String(item.getAttribute('onclick') || '').includes(`showPage('${page}'`));
  }

  function reorderWorkMenu(){
    const nav=document.querySelector('.sb-nav');
    if(!nav)return;
    const sections=[...nav.querySelectorAll('.sb-sec')];
    const accountSection=sections.find(section => (section.textContent || '').trim().toLowerCase().includes('аккаунт')) || sections[1] || null;
    const ordered=[
      sidebarItemByPage('crm'),
      document.getElementById('sb-chats-link') || sidebarItemByPage('chats'),
      document.getElementById('sb-stats-link') || sidebarItemByPage('stats'),
      sidebarItemByPage('archive'),
    ].filter(Boolean);
    const seen=new Set();
    const unique=ordered.filter(item=>{
      if(seen.has(item))return false;
      seen.add(item);
      return true;
    });
    unique.forEach(item => nav.insertBefore(item, accountSection));
  }

  window.atomReorderWorkMenu=reorderWorkMenu;
  const previousShowPageMenuOrder=window.showPage||showPage;
  window.showPage=function(id,el){
    previousShowPageMenuOrder(id,el);
    reorderWorkMenu();
  };
  try{showPage=window.showPage}catch(_){}
  document.addEventListener('DOMContentLoaded',()=>{
    reorderWorkMenu();
    let ticks=0;
    const timer=setInterval(()=>{
      reorderWorkMenu();
      ticks+=1;
      if(ticks>=12)clearInterval(timer);
    },500);
  });
})();

(() => {
  const chatStyle=document.createElement('style');
  chatStyle.textContent=`
    .atom-chat-page{display:grid;grid-template-columns:330px minmax(0,1fr);gap:14px;align-items:start}
    .atom-chat-list-card{min-height:calc(100vh - 116px)}
    .atom-chat-list{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 205px);overflow:auto;padding-right:4px}
    .atom-chat-row{border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;background:rgba(255,255,255,.018);transition:.15s ease}
    .atom-chat-row:hover{border-color:var(--borders);background:rgba(201,168,76,.055)}
    .atom-chat-row.active{border-color:var(--gold);background:rgba(201,168,76,.09)}
    .atom-chat-row-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    .atom-chat-row-name{font-weight:700;color:var(--text);font-size:13px}
    .atom-chat-row-time{font-size:10px;color:var(--dim);white-space:nowrap}
    .atom-chat-unread{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:999px;background:var(--red);color:#fff;font-size:10px;margin-left:6px;padding:0 6px}
    .atom-chat-row-meta{font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .atom-chat-row-last{font-size:11px;color:var(--muted);margin-top:7px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .atom-chat-panel-card{min-height:calc(100vh - 116px);display:flex;flex-direction:column}
    .atom-chat-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px}
    .atom-chat-title{font-size:17px;font-weight:800;color:var(--text)}
    .atom-chat-sub{font-size:11px;color:var(--muted);margin-top:4px}
    .atom-chat-history{height:360px;max-height:42vh;overflow:auto;border:1px solid var(--border);border-radius:8px;background:rgba(0,0,0,.18);padding:12px;display:flex;flex-direction:column;gap:9px}
    .atom-chat-history.large{height:calc(100vh - 360px);min-height:330px;max-height:none}
    .atom-chat-bubble{max-width:min(74%,620px);border:1px solid var(--border);border-radius:10px;padding:9px 10px;font-size:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
    .atom-chat-bubble.client{align-self:flex-start;background:rgba(91,143,212,.09);border-color:rgba(91,143,212,.28)}
    .atom-chat-bubble.manager{align-self:flex-end;background:rgba(75,181,106,.10);border-color:rgba(75,181,106,.30)}
    .atom-chat-bubble.attachment{border-style:dashed}
    .atom-attach-chip{display:inline-flex;align-items:center;width:max-content;margin-bottom:6px;border:1px solid var(--borders);border-radius:999px;padding:2px 8px;color:var(--gold);font-size:10px}
    .atom-attach-link{display:inline-flex;margin-top:7px;color:var(--gold);font-size:11px;text-decoration:none;border-bottom:1px solid rgba(201,168,76,.45)}
    .atom-attach-preview{display:block;margin-top:7px;max-width:220px;max-height:180px;border-radius:8px;border:1px solid var(--border);object-fit:cover}
    .atom-chat-meta{font-size:9px;color:var(--dim);margin-bottom:4px}
    .atom-chat-composer{margin-top:10px;display:grid;gap:8px}
    .atom-chat-composer textarea{min-height:78px;resize:vertical}
    .atom-chat-muted{color:var(--dim);font-size:11px;line-height:1.45}
    .atom-chat-search{width:100%;margin:8px 0 10px}
    .atom-ws-state{font-size:10px;color:var(--dim);margin-top:8px}
    .atom-ws-state.ok{color:var(--green)}
    .atom-ws-state.err{color:var(--red)}
    .atom-modal-tg-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
    .tg-status-panel{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:8px;padding:11px 12px;margin:0 0 12px;background:rgba(255,255,255,.025)}
    .tg-status-panel.ok{border-color:rgba(75,181,106,.42);background:rgba(75,181,106,.10)}
    .tg-status-panel.bad{border-color:rgba(255,91,91,.42);background:rgba(255,91,91,.08)}
    .tg-status-dot{width:10px;height:10px;border-radius:50%;margin-top:4px;background:var(--red);box-shadow:0 0 0 4px rgba(255,91,91,.10)}
    .tg-status-panel.ok .tg-status-dot{background:var(--green);box-shadow:0 0 0 4px rgba(75,181,106,.12)}
    .tg-status-panel b{display:block;color:var(--text);font-size:13px;margin-bottom:3px}
    .tg-status-panel span{display:block;color:var(--muted);font-size:11px;line-height:1.4}
    @media (max-width:920px){.atom-chat-page{grid-template-columns:1fr}.atom-chat-list-card{min-height:auto}.atom-chat-list{max-height:260px}.atom-chat-history.large{height:360px}.atom-modal-tg-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(chatStyle);

  let selectedChatClientId=null;
  let chatPollTimer=null;
  let chatPollBusy=false;
  let atomChatWs=null;
  let atomChatWsReconnect=null;
  let atomChatWsStatus='off';
  const atomUnreadKey='atom_v7_unread_chats';
  const atomUnreadResetKey='atom_v7_unread_reset_20260702';
  let atomUnread=JSON.parse(localStorage.getItem(atomUnreadKey)||'{}');
  if(!localStorage.getItem(atomUnreadResetKey)){
    atomUnread={};
    localStorage.setItem(atomUnreadKey,'{}');
    localStorage.setItem(atomUnreadResetKey,'1');
  }

  function clientById(id){
    return clients.find(c=>String(c.id)===String(id));
  }

  function chatClientList(){
    cleanupDemoTelegramArtifacts();
    return visibleClients()
      .filter(c=>{
        const chat=c.telegramChat||{};
        return chatUsername(c) || (chat.chatId && !isPlaceholderTelegramUsername(chat.username||c.username)) || (Array.isArray(c.telegramMessages)&&c.telegramMessages.length);
      })
      .sort((a,b)=>chatLastAt(b).localeCompare(chatLastAt(a)));
  }

  function filteredChatClientList(){
    const q=String(document.getElementById('chat-search')?.value||'').trim().toLowerCase();
    const list=chatClientList();
    if(!q)return list;
    return list.filter(c=>[
      chatName(c),chatUsername(c),c.phone,c.city,c.category,chatLastMessage(c)?.text
    ].join(' ').toLowerCase().includes(q));
  }

  function chatLastMessage(c){
    const messages=Array.isArray(c.telegramMessages)?c.telegramMessages:[];
    return messages[messages.length-1]||null;
  }

  function chatLastAt(c){
    const last=chatLastMessage(c);
    return String(last?.date||c.telegramChat?.lastMessageAt||c.updatedAt||c.createdAt||'');
  }

  function shortDate(value){
    if(!value)return '';
    const s=String(value).replace('T',' ').replace('Z','');
    return s.slice(0,16);
  }

  function chatName(c){
    return c.name || c.telegramChat?.title || 'Клиент';
  }

  function chatUsername(c){
    const value=c.telegramChat?.username || c.username || '';
    return isPlaceholderTelegramUsername(value)?'':value;
  }
  window.chatUsername=chatUsername;

  function isPlaceholderTelegramUsername(value){
    return /^@?client_\d+$/i.test(String(value||'').trim());
  }

  function cleanupDemoTelegramArtifacts(){
    if(!Array.isArray(clients))return;
    let changed=false;
    clients.forEach(c=>{
      const chat=c.telegramChat||{};
      const username=chat.username || c.username || '';
      if(!isPlaceholderTelegramUsername(username))return;
      if(Array.isArray(c.telegramMessages)&&c.telegramMessages.length)changed=true;
      if(chat.chatId||chat.lastMessageAt||chat.lastMessageText||chat.username)changed=true;
      c.telegramMessages=[];
      c.telegramChat={title:c.name||'',username:'',chatId:'',status:'not_linked',lastMessageAt:'',lastMessageText:''};
      if(isPlaceholderTelegramUsername(c.username))c.username='';
    });
    if(changed){
      __localSave();
      if(authToken)syncClientsToBackendNow().catch(()=>{});
    }
  }

  function chatMessagesHtml(c, large=false){
    const messages=(Array.isArray(c.telegramMessages)?c.telegramMessages:[]).slice(-140);
    if(!messages.length){
      return `<div class="empty-col">История пока пустая. Нажми "Обновить историю", чтобы подтянуть переписку из Telegram.</div>`;
    }
    return messages.map(m=>{
      const isManager=String(m.sender||'').toLowerCase()==='manager';
      const who=isManager?'Менеджер':'Клиент';
      const text=String(m.text||'');
      const parsed=parseAttachmentText(text);
      const isAttachment=parsed.isAttachment;
      return `<div class="atom-chat-bubble ${isManager?'manager':'client'} ${isAttachment?'attachment':''}"><div class="atom-chat-meta">${who} · ${esc(shortDate(m.date))}</div>${isAttachment?'<div class="atom-attach-chip">Вложение</div>':''}${renderMessageText(parsed)}</div>`;
    }).join('');
  }
  window.chatMessagesHtml=chatMessagesHtml;

  function parseAttachmentText(text){
    const lines=String(text||'').split('\n');
    const attachLine=lines.find(line=>line.startsWith('ATTACHMENT:'));
    const url=attachLine?attachLine.replace('ATTACHMENT:','').trim():'';
    const visible=lines.filter(line=>!line.startsWith('ATTACHMENT:')).join('\n').trim();
    return {
      text: visible,
      url,
      isAttachment:/^\[(Фото|Файл|Документ|Видео|Аудио|Photo|File|Document|Video|Audio)/i.test(visible) || !!url,
    };
  }

  function renderMessageText(parsed){
    const safeText=esc(parsed.text||'');
    if(!parsed.url)return safeText;
    const safeUrl=esc(secureAttachmentUrl(parsed.url));
    const isImage=/\.(png|jpe?g|webp|gif)(\?|$)/i.test(parsed.url);
    return `${safeText}${isImage?`<a href="${safeUrl}" target="_blank"><img class="atom-attach-preview" src="${safeUrl}" alt="Вложение"></a>`:''}<br><a class="atom-attach-link" href="${safeUrl}" target="_blank">Открыть файл</a>`;
  }

  function secureAttachmentUrl(url){
    const value=String(url||'');
    return value;
  }

  function scrollChatToBottom(id){
    setTimeout(()=>{
      const box=document.getElementById(id);
      if(box)box.scrollTop=box.scrollHeight;
    },0);
  }
  window.scrollChatToBottom=scrollChatToBottom;

  function isNearBottom(box){
    return !box || (box.scrollHeight-box.scrollTop-box.clientHeight)<80;
  }

  function updateChatHistoryBox(boxId,c){
    const box=document.getElementById(boxId);
    if(!box)return;
    const shouldStick=isNearBottom(box);
    box.innerHTML=chatMessagesHtml(c,box.classList.contains('large'));
    if(shouldStick)scrollChatToBottom(boxId);
  }

  function ensureChatsPage(){
    const nav=document.querySelector('.sb-nav');
    if(nav&&!document.getElementById('sb-chats-link')){
      const archive=[...nav.querySelectorAll('.sb-item')].find(item=>item.textContent.includes('Архив'));
      const html=`<div class="sb-item" id="sb-chats-link" data-onclick="showPage('chats',this)">✉ Чаты <span class="sb-badge" id="chats-badge" style="display:none">0</span></div>`;
      if(archive)archive.insertAdjacentHTML('afterend',html);
      else nav.insertAdjacentHTML('beforeend',html);
    }
    const content=document.querySelector('.content');
    if(content&&!document.getElementById('page-chats')){
      content.insertAdjacentHTML('beforeend',`<section class="page" id="page-chats"><div id="chats-content"></div></section>`);
    }
    updateChatsBadge();
  }

  function updateChatsBadge(){
    const badge=document.getElementById('chats-badge');
    if(!badge)return;
    atomUnread={};
    localStorage.setItem(atomUnreadKey,JSON.stringify(atomUnread));
    badge.style.display='none';
    badge.textContent='';
  }

  function sanitizeUnread(){
    const ids=new Set(visibleClients().map(c=>String(c.id)));
    let changed=false;
    Object.keys(atomUnread||{}).forEach(id=>{
      if(!ids.has(String(id)) || Number(atomUnread[id]||0)<=0){
        delete atomUnread[id];
        changed=true;
      }
    });
    if(changed)localStorage.setItem(atomUnreadKey,JSON.stringify(atomUnread||{}));
  }

  function unreadTotal(){
    return Object.values(atomUnread||{}).reduce((sum,value)=>sum+Number(value||0),0);
  }

  function saveUnread(){
    localStorage.setItem(atomUnreadKey,JSON.stringify(atomUnread||{}));
    updateChatsBadge();
  }

  function clearUnread(id){
    if(!id || !atomUnread[id])return;
    delete atomUnread[id];
    saveUnread();
  }

  function renderChatsPage(){
    ensureChatsPage();
    const root=document.getElementById('chats-content');
    if(!root)return;
    const list=filteredChatClientList();
    if(!list.length){
      root.innerHTML=`<div class="card"><div class="card-title">Чаты клиентов</div><input class="fi atom-chat-search" id="chat-search" placeholder="Поиск: имя, username, телефон, текст" data-oninput="renderChatsListOnly()"><div class="empty-col">Пока нет клиентов с Telegram или ничего не найдено.</div></div>`;
      sendChatWatch();
      return;
    }
    if(!selectedChatClientId || !list.some(c=>String(c.id)===String(selectedChatClientId))){
      selectedChatClientId=String(list[0].id);
    }
    const selected=clientById(selectedChatClientId)||list[0];
    root.innerHTML=`<div class="atom-chat-page">
      <div class="card atom-chat-list-card">
        <div class="card-title">Чаты клиентов</div>
        <div class="atom-chat-muted" style="margin-bottom:10px">Здесь собраны Telegram-диалоги по доступным тебе клиентам.</div>
        <input class="fi atom-chat-search" id="chat-search" placeholder="Поиск: имя, username, телефон, текст" data-oninput="renderChatsListOnly()">
        <div class="atom-chat-list" id="atom-chat-list">${chatRowsHtml(list)}</div>
        <div class="atom-ws-state ${atomChatWsStatus==='ok'?'ok':atomChatWsStatus==='err'?'err':''}" id="atom-ws-state">${wsStateText()}</div>
      </div>
      <div class="card atom-chat-panel-card" id="atom-chat-panel">${chatPanelHtml(selected)}</div>
    </div>`;
    scrollChatToBottom('atom-chat-main-history');
    clearUnread(selectedChatClientId);
    connectChatWebSocket();
    sendChatWatch();
  }

  function chatRowsHtml(list){
    return list.map(c=>{
      const last=chatLastMessage(c);
      const active=String(c.id)===String(selectedChatClientId);
      const unread=Number(atomUnread[c.id]||0);
      return `<div class="atom-chat-row ${active?'active':''}" data-onclick="selectChatClient('${esc(c.id)}')">
        <div class="atom-chat-row-top"><div class="atom-chat-row-name">${esc(chatName(c))}${unread?`<span class="atom-chat-unread">${unread}</span>`:''}</div><div class="atom-chat-row-time">${esc(shortDate(last?.date||c.telegramChat?.lastMessageAt))}</div></div>
        <div class="atom-chat-row-meta">${esc(chatUsername(c)||'username не указан')} · ${esc(c.phone||'телефон не указан')}</div>
        <div class="atom-chat-row-last">${esc(last?.text||c.telegramChat?.lastMessageText||'История еще не загружена')}</div>
      </div>`;
    }).join('');
  }

  window.renderChatsListOnly=function(){
    const listBox=document.getElementById('atom-chat-list');
    if(!listBox)return;
    listBox.innerHTML=chatRowsHtml(filteredChatClientList());
    sendChatWatch();
  };

  function chatPanelHtml(c){
    const username=String(chatUsername(c)||'').replace('@','');
    return `<div class="atom-chat-head">
      <div><div class="atom-chat-title">${esc(chatName(c))}</div><div class="atom-chat-sub">${esc(c.city||'')} · ${esc(c.phone||'')} · ${esc(chatUsername(c)||'username не указан')}</div></div>
      <div class="quick-actions" style="margin-top:0">${username?`<button class="btn btn-b btn-xs" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}<button class="btn btn-xs" data-onclick="openClient('${esc(c.id)}')">Карточка</button></div>
    </div>
    <div class="atom-chat-history large" id="atom-chat-main-history">${chatMessagesHtml(c,true)}</div>
    <div class="atom-chat-composer">
      <textarea class="fi" id="chat-center-draft" placeholder="Напишите сообщение. Enter - отправить, Shift+Enter - новая строка"></textarea>
      <div class="quick-actions">
        <button class="btn btn-g" data-onclick="sendChatCenterMessage('${esc(c.id)}',this)">Отправить в Telegram</button>
        <button class="btn btn-b" data-onclick="refreshChatCenterHistory('${esc(c.id)}',this)">Обновить историю</button>
      </div>
    </div>`;
  }

  window.selectChatClient=function(id){
    selectedChatClientId=String(id);
    clearUnread(selectedChatClientId);
    const c=clientById(selectedChatClientId);
    const panel=document.getElementById('atom-chat-panel');
    const listBox=document.getElementById('atom-chat-list');
    if(c&&panel&&listBox){
      const scrollTop=listBox.scrollTop;
      listBox.innerHTML=chatRowsHtml(filteredChatClientList());
      listBox.scrollTop=scrollTop;
      panel.innerHTML=chatPanelHtml(c);
      scrollChatToBottom('atom-chat-main-history');
    }else{
      renderChatsPage();
    }
    sendChatWatch();
  };

  window.sendChatCenterMessage=async function(id,btn){
    const c=clientById(id);
    const input=document.getElementById('chat-center-draft');
    const text=String(input?.value||'').trim();
    if(!c||!text){atomToast?.('Введите сообщение');return}
    const old=btn?.textContent;
    if(btn){btn.textContent='Отправляю...';btn.disabled=true}
    try{
      await syncClientsToBackendNow();
      const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/send-telegram',{
        method:'POST',
        body:JSON.stringify({client:clientPayload(c),text})
      });
      Object.assign(c,normalizeClient({...c,...data.client}));
      __localSave();
      if(input)input.value='';
      renderChatsPage();
      renderCRM();
      renderCabinet();
      atomToast?.('Сообщение отправлено в Telegram');
    }catch(e){
      atomToast?.('Не удалось отправить в Telegram: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.refreshChatCenterHistory=async function(id,btn){
    const c=clientById(id);
    if(!c)return;
    const draftBefore=document.getElementById('chat-center-draft')?.value||'';
    const old=btn?.textContent;
    if(btn){btn.textContent='Обновляю...';btn.disabled=true}
    try{
      await syncClientsToBackendNow();
      const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
        method:'POST',
        body:JSON.stringify({client:clientPayload(c),historyLimit:100})
      });
      Object.assign(c,normalizeClient({...c,...data.client}));
      __localSave();
      renderChatsPage();
      const draftAfter=document.getElementById('chat-center-draft');
      if(draftAfter)draftAfter.value=draftBefore;
      renderCRM();
      renderCabinet();
      atomToast?.('История Telegram обновлена');
    }catch(e){
      console.warn('Telegram history refresh skipped:', e.message);
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  async function refreshChatMessagesOnly(id){
    const c=clientById(id);
    if(!c||!authToken||chatPollBusy)return;
    try{
      chatPollBusy=true;
      const before=(c.telegramMessages||[]).map(m=>`${m.messageId||''}:${m.date||''}:${m.text||''}`).join('|');
      const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
        method:'POST',
        body:JSON.stringify({client:clientPayload(c),historyLimit:40})
      });
      if(data.client){
        Object.assign(c,normalizeClient({...c,...data.client}));
        const after=(c.telegramMessages||[]).map(m=>`${m.messageId||''}:${m.date||''}:${m.text||''}`).join('|');
        if(before===after)return;
        __localSave();
        if(document.getElementById('page-chats')?.classList.contains('active')&&String(selectedChatClientId)===String(id)){
          updateChatHistoryBox('atom-chat-main-history',c);
          const activeRow=document.querySelector('.atom-chat-row.active');
          const last=chatLastMessage(c);
          const timeEl=activeRow?.querySelector('.atom-chat-row-time');
          const lastEl=activeRow?.querySelector('.atom-chat-row-last');
          if(timeEl)timeEl.textContent=shortDate(last?.date||c.telegramChat?.lastMessageAt);
          if(lastEl)lastEl.textContent=last?.text||c.telegramChat?.lastMessageText||'';
        }
        if(String(activeClientId)===String(id)&&document.getElementById('mtab-chat')?.classList.contains('active')){
          updateChatHistoryBox('modal-tg-history',c);
        }
      }
    }catch(e){
      const note=document.querySelector('#atom-chat-panel .sync-state, #telegram-client-content .sync-state');
      if(note)note.textContent='Автообновление Telegram не прошло: '+e.message;
    }finally{
      chatPollBusy=false;
    }
  }

  function connectChatWebSocket(){
    if(!authToken || (atomChatWs && [0,1].includes(atomChatWs.readyState)))return;
    clearTimeout(atomChatWsReconnect);
    const protocol=location.protocol==='https:'?'wss':'ws';
    atomChatWs=new WebSocket(`${protocol}://${location.host}/ws`,['atom.crm.auth',authToken]);
    atomChatWsStatus='connecting';
    updateWsState();
    atomChatWs.addEventListener('open',()=>{
      atomChatWsStatus='ok';
      updateWsState();
      sendChatWatch();
    });
    atomChatWs.addEventListener('message',(event)=>{
      let payload=null;
      try{payload=JSON.parse(event.data)}catch{return}
      handleChatWsMessage(payload);
    });
    atomChatWs.addEventListener('close',()=>{
      atomChatWsStatus='err';
      updateWsState();
      atomChatWsReconnect=setTimeout(connectChatWebSocket,3000);
    });
    atomChatWs.addEventListener('error',()=>{
      atomChatWsStatus='err';
      updateWsState();
    });
  }

  function sendChatWatch(){
    if(!atomChatWs || atomChatWs.readyState!==1)return;
    atomChatWs.send(JSON.stringify({
      type:'watch-chats',
      activeClientId:selectedChatClientId||activeClientId||'',
      visibleClientIds:chatClientList().map(c=>c.id),
    }));
  }

  function handleChatWsMessage(payload){
    if(payload.type==='telegram-update'&&payload.client){
      const existing=clientById(payload.client.id);
      if(existing)Object.assign(existing,normalizeClient({...existing,...payload.client}));
      else clients.push(normalizeClient(payload.client));
      __localSave();
      const c=clientById(payload.client.id);
      const isOpenChat=document.getElementById('page-chats')?.classList.contains('active')&&String(selectedChatClientId)===String(c.id);
      const isOpenModal=String(activeClientId)===String(c.id)&&document.getElementById('mtab-chat')?.classList.contains('active');
      const incoming=(payload.messages||[]).filter(m=>String(m.sender)!=='manager');
      if(!isOpenChat&&!isOpenModal&&incoming.length){
        atomUnread[c.id]=Number(atomUnread[c.id]||0)+incoming.length;
        saveUnread();
      }else{
        clearUnread(c.id);
      }
      if(isOpenChat)updateChatHistoryBox('atom-chat-main-history',c);
      if(isOpenModal)updateChatHistoryBox('modal-tg-history',c);
      renderChatsListOnly();
      renderCRM();
      if(incoming.length){
        showIncomingTelegramToast(c,incoming.at(-1));
      }
    }
    if(payload.type==='telegram-error'){
      const note=document.querySelector('#atom-ws-state, #telegram-client-content .sync-state');
      if(note)note.textContent='Telegram подключится после авторизации аккаунта менеджера.';
      console.warn('Telegram live refresh skipped:', payload.error);
    }
  }

  function showIncomingTelegramToast(c,message){
    const text=String(message?.text||'').split('\n').find(line=>!line.startsWith('ATTACHMENT:'))||'Новое сообщение';
    atomToast?.(`Новое сообщение от ${chatName(c)}: ${text.slice(0,90)}`);
  }

  function wsStateText(){
    if(atomChatWsStatus==='ok')return 'WebSocket подключен: входящие приходят автоматически.';
    if(atomChatWsStatus==='connecting')return 'Подключаю live-обновление...';
    if(atomChatWsStatus==='err')return 'Live-обновление переподключается...';
    return 'Live-обновление включится при открытии чатов.';
  }

  function updateWsState(){
    const state=document.getElementById('atom-ws-state');
    if(state){
      state.className=`atom-ws-state ${atomChatWsStatus==='ok'?'ok':atomChatWsStatus==='err'?'err':''}`;
      state.textContent=wsStateText();
    }
  }

  function startChatPoll(){
    clearInterval(chatPollTimer);
    chatPollTimer=setInterval(()=>{
      sendChatWatch();
      if(document.getElementById('page-chats')?.classList.contains('active')&&selectedChatClientId){
        refreshChatMessagesOnly(selectedChatClientId).catch(()=>{});
      }
      if(document.getElementById('client-modal')?.classList.contains('open')&&document.getElementById('mtab-chat')?.classList.contains('active')&&activeClientId){
        refreshChatMessagesOnly(activeClientId).catch(()=>{});
      }
    },5000);
  }

  const baseShowPage=window.showPage||showPage;
  window.showPage=function(id,el){
    ensureChatsPage();
    if(id==='chats'){
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(n=>n.classList.remove('active'));
      document.getElementById('page-chats')?.classList.add('active');
      (el||document.getElementById('sb-chats-link'))?.classList.add('active');
      const title=document.getElementById('topbar-title');
      if(title)title.textContent='Чаты клиентов';
      renderChatsPage();
      connectChatWebSocket();
      sendChatWatch();
      if(selectedChatClientId)refreshChatMessagesOnly(selectedChatClientId).catch(()=>{});
      return;
    }
    baseShowPage(id,el);
  };

  const baseRenderCRM=window.renderCRM||renderCRM;
  window.renderCRM=function(){
    baseRenderCRM();
    updateChatsBadge();
    connectChatWebSocket();
    sendChatWatch();
  };

  const baseRenderTelegramClient=window.renderTelegramClient||renderTelegramClient;
  window.renderTelegramClient=function(c){
    const root=document.getElementById('telegram-client-content');
    if(!root||!c)return baseRenderTelegramClient(c);
    const username=String(chatUsername(c)||'').replace('@','');
    root.innerHTML=`<div class="card">
      <div class="card-title">Telegram клиента</div>
      <div class="atom-modal-tg-grid">
        <div><div class="fl">Чат / имя</div><input class="fi" id="tg-client-title" value="${esc(c.telegramChat?.title||c.name||'')}"></div>
        <div><div class="fl">Username</div><input class="fi" id="tg-client-username" value="${esc(c.telegramChat?.username||c.username||'')}" placeholder="@username"></div>
        <div><div class="fl">Chat ID</div><input class="fi" id="tg-client-chatid" value="${esc(c.telegramChat?.chatId||'')}" placeholder="заполнится после импорта"></div>
      </div>
      <div class="atom-chat-history" id="modal-tg-history">${chatMessagesHtml(c)}</div>
      <div class="atom-chat-composer">
        <div class="msg-lbl">Сообщение менеджера</div>
        <textarea class="fi" id="tg-draft" rows="4" placeholder="Напишите сообщение. Enter - отправить, Shift+Enter - новая строка"></textarea>
        <div class="quick-actions">
          <button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>
          <button class="btn btn-b" data-onclick="linkAndImportTelegram(this)">Обновить историю</button>
          ${username?`<button class="btn" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}
        </div>
        <div class="sync-state">Чат ищется по username или chat id. История хранится в PostgreSQL и обновляется кнопкой выше или через экран "Чаты".</div>
      </div>
    </div>`;
    scrollChatToBottom('modal-tg-history');
    connectChatWebSocket();
    sendChatWatch();
  };

  const baseCloseModal=window.closeModal||closeModal;
  window.closeModal=function(){
    baseCloseModal();
    if(document.getElementById('page-chats')?.classList.contains('active'))renderChatsPage();
  };

  const baseBootApp=window.bootApp||bootApp;
  window.bootApp=function(){
    baseBootApp();
    ensureChatsPage();
    connectChatWebSocket();
    sendChatWatch();
  };

  document.addEventListener('keydown',(event)=>{
    if(event.isComposing||event.key!=='Enter'||event.shiftKey)return;
    const target=event.target;
    if(!(target instanceof HTMLTextAreaElement))return;
    if(target.id==='chat-center-draft'&&selectedChatClientId){
      event.preventDefault();
      const btn=document.querySelector('#atom-chat-panel .btn.btn-g');
      sendChatCenterMessage(selectedChatClientId,btn);
    }
    if(target.id==='tg-draft'&&activeClientId){
      event.preventDefault();
      const btn=document.getElementById('send-telegram-message');
      sendTelegramDraft(btn);
    }
  });

  document.addEventListener('DOMContentLoaded',()=>{
    ensureChatsPage();
    connectChatWebSocket();
    sendChatWatch();
    startChatPoll();
  });
})();

(function(){
  const atomSiteStyle=document.createElement('style');
  atomSiteStyle.textContent=`
    :root{
      --bg:#000000;
      --bg2:#0c0c0c;
      --bg3:#111111;
      --bg4:#17191f;
      --border:rgba(255,255,255,.07);
      --borders:rgba(91,138,255,.30);
      --text:#f0f0f0;
      --muted:rgba(240,240,240,.55);
      --dim:rgba(240,240,240,.35);
      --gold:#5b8aff;
      --gold-l:#5b8aff;
      --green:#22c55e;
      --blue:#5b8aff;
      --red:#ef4444;
    }
    body{font-family:Inter,system-ui,sans-serif;background:radial-gradient(circle at 42% -18%,rgba(91,138,255,.16),transparent 34%),#000;color:var(--text)}
    .sb{background:#050505;border-right:1px solid rgba(255,255,255,.07)}
    .sb-logo,.sb-profile,.sb-bottom{border-color:rgba(255,255,255,.07)}
    .sb-logo-t,.auth-logo{color:var(--text)}
    .sb-logo-t{text-transform:uppercase;font-family:Inter,system-ui,sans-serif;font-weight:900;letter-spacing:.01em}
    .auth-logo{text-transform:uppercase;font-family:Inter,system-ui,sans-serif;font-weight:900;letter-spacing:.01em}
    .sb-logo-s,.brand-sub{color:var(--blue)}
    .topbar{background:rgba(5,5,5,.92);border-bottom:1px solid rgba(255,255,255,.07);backdrop-filter:blur(14px)}
    .card,.live-col,.live-money,.nc-form,.archive-card,.md,.atom-details,.atom-chat-list-card,.atom-chat-panel-card{background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0)),#0c0c0c;border-color:rgba(255,255,255,.07);box-shadow:none;border-radius:16px}
    .card-title,.live-col-title{color:var(--blue);letter-spacing:.08em;text-transform:uppercase}
    .live-money{background:linear-gradient(135deg,rgba(91,138,255,.15),rgba(91,138,255,.03)),#0c0c0c;border-color:rgba(91,138,255,.30)}
    .g,.green.g,.live-money-main,.deal-amt,.archive-money,.res-val.gold,.hero-money-val,.fl-num,.kpi-value,.goal-big{color:var(--blue)!important}
    .btn{border-radius:10px;background:rgba(91,138,255,.10);border-color:rgba(91,138,255,.30);color:#d7e3ff;font-weight:600}
    .btn:hover{background:rgba(91,138,255,.15);border-color:rgba(91,138,255,.45)}
    .btn-g{background:rgba(34,197,94,.10);border-color:rgba(34,197,94,.35);color:var(--green)}
    .btn-g:hover{background:rgba(34,197,94,.20);border-color:rgba(34,197,94,.60)}
    .btn-b{background:rgba(91,138,255,.10);border-color:rgba(91,138,255,.30);color:var(--blue)}
    .btn-r{background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.30);color:var(--red)}
    .fi,.fs,.search-box,.filter-sel{background:#111;border-color:rgba(255,255,255,.12);color:var(--text);border-radius:12px}
    .fi:focus,.fs:focus,.search-box:focus,.filter-sel:focus{border-color:rgba(91,138,255,.65);box-shadow:0 0 0 3px rgba(91,138,255,.10);outline:none}
    .sb-item.active{background:rgba(91,138,255,.15);border-left-color:var(--blue);color:var(--text)}
    .deal-card{background:linear-gradient(90deg,rgba(34,197,94,.07),rgba(12,12,12,.98) 42%);border-color:rgba(255,255,255,.07);border-radius:14px}
    .deal-card.losing{background:linear-gradient(90deg,rgba(91,138,255,.15),rgba(12,12,12,.98) 42%);border-color:rgba(91,138,255,.30)}
    .deal-card:hover,.archive-card:hover,.atom-chat-row:hover{border-color:rgba(91,138,255,.30);background-color:rgba(91,138,255,.055)}
    .deal-progress,.sop-track,.stat-bar-track,.goal-track,.metric-line,.bar-fill-ui{background:rgba(255,255,255,.055)}
    .deal-progress-fill,.stat-bar-fill,.sop-bar,.goal-fill,.metric-line>span,.bar-fill-ui>span{
      background:linear-gradient(90deg,rgba(91,138,255,.78),rgba(91,138,255,.38));
      box-shadow:0 0 10px rgba(91,138,255,.10);
    }
    .contact-pill,.deal-pill{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.10);color:rgba(240,240,240,.70);border-radius:8px}
    .atom-chat-row.active{background:rgba(91,138,255,.15);border-color:rgba(91,138,255,.45)}
    .atom-bubble.client{background:#111;border-color:rgba(91,138,255,.18)}
    .atom-bubble.manager{background:rgba(34,197,94,.10);border-color:rgba(34,197,94,.24)}
    .atom-details summary{color:var(--text)}
    .atom-details[open],.atom-details:hover{border-color:rgba(91,138,255,.30)}
    .atom-details summary:after{border-color:rgba(91,138,255,.30);color:var(--blue)}
    .archive-status.done,.atom-status-badge.done{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.30);color:var(--green)}
    .archive-status.lost,.atom-status-badge.lost{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.30);color:var(--red)}
    .atom-inbox-convert{margin-top:14px}
    .auth-btn{background:var(--blue);color:#fff}
    .deal-time.warn,.deal-time.danger{color:var(--blue)}
    .sop-step-tag,.loss-title,.md-title{color:var(--blue)}
    .copy-btn{background:rgba(91,138,255,.10);border-color:rgba(91,138,255,.30);color:var(--blue)}
    .chip.sel,.cdt.active{background:rgba(91,138,255,.15);border-color:rgba(91,138,255,.35);color:var(--blue)}
    .md-tab.active{color:var(--blue);border-bottom-color:var(--blue)}
    .sb-avatar{background:rgba(91,138,255,.15);border-color:rgba(91,138,255,.30);color:var(--blue)}
    .live-col-title,.card-title,.hero-kicker,.mc-value,.topbar-title{color:var(--blue)}
    .atom-table tbody tr:hover{background:rgba(91,138,255,.07)}
    .atom-status-badge.losing{background:rgba(91,138,255,.14);border-color:rgba(91,138,255,.28);color:var(--blue)}
    .atom-attach-link{color:var(--blue)}
    .atom-details[open]{border-color:rgba(91,138,255,.34)}
    .clean-funnel .funnel-row:before,.dash-hero{background:linear-gradient(135deg,rgba(91,138,255,.15),rgba(91,138,255,.03)),#0c0c0c}
    .funnel-row:before{border-color:rgba(91,138,255,.22)}
  `;
  document.head.appendChild(atomSiteStyle);
})();

(function(){
  let atomInboxChats=[];
  let atomSelectedInboxId='';

  function ensureTelegramInboxShell(){
    const nav=document.querySelector('.sb-nav');
    if(nav&&!document.getElementById('sb-chats-link')){
      const accountSec=[...document.querySelectorAll('.sb-sec')].find(el=>(el.textContent||'').toLowerCase().includes('аккаунт'));
      const html=`<div class="sb-item" id="sb-chats-link" data-onclick="showPage('chats',this)">✉ Чаты <span class="sb-badge" id="chats-badge" style="display:none">0</span></div>`;
      if(accountSec)accountSec.insertAdjacentHTML('beforebegin',html);
      else nav.insertAdjacentHTML('beforeend',html);
    }
    const content=document.querySelector('.content');
    if(content&&!document.getElementById('page-chats')){
      content.insertAdjacentHTML('beforeend',`<section class="page" id="page-chats"><div id="chats-content"></div></section>`);
    }
  }

  async function loadTelegramInbox(){
    const data=await backendRequest('/api/telegram-inbox');
    atomInboxChats=Array.isArray(data.chats)?data.chats:[];
    return atomInboxChats;
  }

  function inboxChatById(id){
    return atomInboxChats.find(chat=>String(chat.id)===String(id));
  }

  function inboxLastMessage(chat){
    const messages=Array.isArray(chat.messages)?chat.messages:[];
    return messages.at(-1)||null;
  }

  function inboxTitle(chat){
    return chat.title||chat.username||chat.phone||'Telegram чат';
  }

  function inboxRowsHtml(){
    const q=String(document.getElementById('atom-inbox-search')?.value||'').toLowerCase();
    const rows=atomInboxChats.filter(chat=>{
      const last=inboxLastMessage(chat);
      return !q || [chat.title,chat.username,chat.phone,last?.text,chat.lastMessageText].join(' ').toLowerCase().includes(q);
    });
    if(!rows.length)return '<div class="empty-col">Неразобранных личных чатов пока нет.</div>';
    return rows.map(chat=>{
      const last=inboxLastMessage(chat);
      const active=String(chat.id)===String(atomSelectedInboxId);
      return `<div class="atom-chat-row ${active?'active':''}" data-onclick="selectTelegramInboxChat('${esc(chat.id)}')">
        <div class="atom-chat-row-top"><div class="atom-chat-row-name">${esc(inboxTitle(chat))}</div><div class="atom-chat-row-time">${esc(shortDate(last?.date||chat.lastMessageAt))}</div></div>
        <div class="atom-chat-row-meta">${esc(chat.username||'username не указан')} · ${esc(chat.phone||'телефон не указан')}</div>
        <div class="atom-chat-row-last">${esc(last?.text||chat.lastMessageText||'История еще не загружена')}</div>
      </div>`;
    }).join('');
  }

  function inboxMessagesHtml(chat){
    const messages=(Array.isArray(chat?.messages)?chat.messages:[]).slice(-120);
    if(!messages.length)return '<div class="empty-col">История пока пустая.</div>';
    return messages.map(message=>{
      const side=message.sender==='manager'?'manager':'client';
      return `<div class="atom-bubble ${side}">
        <div class="atom-bubble-meta">${side==='manager'?'Менеджер':'Клиент'} · ${esc(shortDate(message.date))}</div>
        <div>${formatMessageText(message.text||'')}</div>
      </div>`;
    }).join('');
  }

  function inboxPanelHtml(chat){
    if(!chat)return `<div class="empty-col">Выберите чат слева.</div>`;
    const username=String(chat.username||'').replace('@','');
    return `<div class="atom-chat-head">
      <div><div class="atom-chat-title">${esc(inboxTitle(chat))}</div><div class="atom-chat-sub">${esc(chat.username||'username не указан')} · ${esc(chat.phone||'телефон не указан')}</div></div>
      <div class="quick-actions" style="margin-top:0">
        ${username?`<button class="btn btn-b btn-xs" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}
        <button class="btn btn-r btn-xs" data-onclick="deleteTelegramInboxChat('${esc(chat.id)}',this)">Удалить чат</button>
      </div>
    </div>
    <div class="atom-chat-history large" id="atom-inbox-history">${inboxMessagesHtml(chat)}</div>
    <div class="card atom-inbox-convert">
      <div class="card-title">Оформить как клиента CRM</div>
      <div class="fg3">
        <div><div class="fl">Имя клиента</div><input class="fi" id="inbox-client-name" value="${esc(inboxTitle(chat))}"></div>
        <div><div class="fl">Сумма ₽</div><input class="fi" id="inbox-client-amount" type="number" placeholder="500000"></div>
        <div><div class="fl">Город</div><select class="fs" id="inbox-client-city"><option>Уфа</option><option>Казань</option><option>Екатеринбург</option><option>Москва</option></select></div>
      </div>
      <div class="fg3" style="margin-top:10px">
        <div><div class="fl">Категория</div><select class="fs" id="inbox-client-category"><option>Криптообмен</option><option>Автомобили</option><option>Недвижимость</option><option>Цветы</option><option>Табак / уголь</option><option>Китай / импорт</option></select></div>
        <div><div class="fl">Направление</div><select class="fs" id="inbox-client-dir"><option value="buy">Рубли → USDT</option><option value="sell">USDT → Рубли</option></select></div>
        <div><div class="fl">Ответственный</div><select class="fs" id="inbox-client-owner">${managerSelectOptions(profile?.login||'nikita')}</select></div>
      </div>
      <div class="quick-actions"><button class="btn btn-g" data-onclick="createClientFromInbox('${esc(chat.id)}',this)">Создать клиента</button></div>
    </div>`;
  }

  window.renderTelegramInboxPage=async function(){
    ensureTelegramInboxShell();
    const root=document.getElementById('chats-content');
    if(!root)return;
    root.innerHTML=`<div class="card atom-inbox-loading"><div class="card-title">Telegram inbox</div><div class="empty-col">Загружаю чаты...</div></div>`;
    try{
      await loadTelegramInbox();
      if(!atomSelectedInboxId || !atomInboxChats.some(chat=>String(chat.id)===String(atomSelectedInboxId))){
        atomSelectedInboxId=atomInboxChats[0]?.id||'';
      }
      const selected=inboxChatById(atomSelectedInboxId);
      root.innerHTML=`<div class="atom-chat-page atom-inbox-page">
        <div class="card atom-chat-list-card">
          <div class="card-title">Telegram inbox</div>
          <div class="atom-chat-muted" style="margin-bottom:10px">Только личные диалоги с людьми. Группы, каналы и боты не импортируются.</div>
          <div class="quick-actions"><button class="btn btn-g" data-onclick="importPrivateTelegramChats(this)">Импортировать личные чаты</button></div>
          <input class="fi atom-chat-search" id="atom-inbox-search" placeholder="Поиск: имя, username, телефон, текст" data-oninput="renderTelegramInboxRowsOnly()">
          <div class="atom-chat-list" id="atom-inbox-list">${inboxRowsHtml()}</div>
        </div>
        <div class="card atom-chat-panel-card" id="atom-inbox-panel">${inboxPanelHtml(selected)}</div>
      </div>
      <details class="atom-details atom-client-chat-details"><summary><span>Чаты клиентов CRM</span><span class="atom-details-hint">Открыть</span></summary><div class="atom-details-body" id="atom-client-chats-fallback"></div></details>`;
      document.getElementById('atom-client-chats-fallback').innerHTML=`<div class="empty-col">Клиентские чаты доступны в карточках клиентов. Inbox выше нужен для разбора новых Telegram-диалогов.</div>`;
      scrollChatToBottom?.('atom-inbox-history');
    }catch(e){
      root.innerHTML=`<div class="card"><div class="card-title">Telegram inbox</div><div class="empty-col">Не удалось загрузить inbox: ${esc(e.message||e)}</div></div>`;
    }
  };

  window.renderTelegramInboxRowsOnly=function(){
    const list=document.getElementById('atom-inbox-list');
    if(list)list.innerHTML=inboxRowsHtml();
  };

  window.selectTelegramInboxChat=function(id){
    atomSelectedInboxId=String(id);
    const list=document.getElementById('atom-inbox-list');
    const panel=document.getElementById('atom-inbox-panel');
    if(list)list.innerHTML=inboxRowsHtml();
    if(panel)panel.innerHTML=inboxPanelHtml(inboxChatById(id));
    scrollChatToBottom?.('atom-inbox-history');
  };

  window.importPrivateTelegramChats=async function(btn){
    const old=btn?.textContent;
    if(btn){btn.textContent='Импортирую...';btn.disabled=true}
    try{
      const data=await backendRequest('/api/telegram-inbox/import-private',{
        method:'POST',
        body:JSON.stringify({dialogsLimit:150,historyLimit:40})
      });
      atomToast?.(`Импортировано личных чатов: ${data.chatsCount||0}`);
      await renderTelegramInboxPage();
    }catch(e){
      atomToast?.('Не удалось импортировать чаты: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.deleteTelegramInboxChat=async function(id,btn){
    if(!confirm('Удалить этот импортированный чат из CRM? В Telegram он не удалится.'))return;
    const old=btn?.textContent;
    if(btn){btn.textContent='Удаляю...';btn.disabled=true}
    try{
      await backendRequest('/api/telegram-inbox/'+encodeURIComponent(id),{method:'DELETE'});
      atomInboxChats=atomInboxChats.filter(chat=>String(chat.id)!==String(id));
      if(atomSelectedInboxId===String(id))atomSelectedInboxId=atomInboxChats[0]?.id||'';
      await renderTelegramInboxPage();
      atomToast?.('Чат удален из CRM');
    }catch(e){
      atomToast?.('Не удалось удалить чат: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.createClientFromInbox=async function(id,btn){
    const chat=inboxChatById(id);
    if(!chat)return;
    const name=document.getElementById('inbox-client-name')?.value.trim()||inboxTitle(chat);
    const amount=Number(document.getElementById('inbox-client-amount')?.value||0);
    const city=document.getElementById('inbox-client-city')?.value||'Уфа';
    const category=document.getElementById('inbox-client-category')?.value||'Криптообмен';
    const direction=document.getElementById('inbox-client-dir')?.value||'buy';
    const assignedTo=document.getElementById('inbox-client-owner')?.value||profile?.login||'nikita';
    const client=normalizeClient({
      id:gid(),
      name,
      phone:chat.phone||'',
      username:chat.username||'',
      city,
      category,
      source:'Telegram',
      amount,
      direction,
      stage:'active',
      assignedTo,
      createdAt:new Date().toISOString(),
      nextTouchDate:nextTouchDate(DEFAULT_TOUCH_DAYS),
      touchFrequency:DEFAULT_TOUCH_DAYS,
      telegramChat:{chatId:chat.chatId,title:chat.title||name,username:chat.username||'',status:'linked',lastMessageAt:chat.lastMessageAt,lastMessageText:chat.lastMessageText},
      telegramMessages:(chat.messages||[]),
      comment:'Создано из Telegram inbox',
      deals:[{id:gid(),createdAt:new Date().toISOString(),amount,stage:'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)}],
      calcData:{rate:82,spread:.2,amount,fee:amount<250000},
    });
    const old=btn?.textContent;
    if(btn){btn.textContent='Создаю...';btn.disabled=true}
    try{
      clients.unshift(client);
      save();
      await syncClientsToBackendNow();
      await backendRequest('/api/telegram-inbox/'+encodeURIComponent(id),{method:'DELETE'});
      atomToast?.('Клиент создан из Telegram-чата');
      renderCRM();
      await renderTelegramInboxPage();
      openClient(client.id);
    }catch(e){
      atomToast?.('Не удалось создать клиента: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  const previousShowPageForInbox=window.showPage||showPage;
  window.showPage=function(id,el){
    if(id==='chats'){
      ensureTelegramInboxShell();
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(n=>n.classList.remove('active'));
      document.getElementById('page-chats')?.classList.add('active');
      (el||document.getElementById('sb-chats-link'))?.classList.add('active');
      const title=document.getElementById('topbar-title');
      if(title)title.textContent='Чаты';
      renderTelegramInboxPage();
      return;
    }
    previousShowPageForInbox(id,el);
  };
  try{showPage=window.showPage}catch(_){}
})();

(function(){
  function openStages(){
    return ['active','losing'];
  }

  function normalizeRemovedLossStage(){
    if(!Array.isArray(clients))return;
    clients.forEach(c=>{
      if(c.stage==='losing'){
        c.stage='active';
        if(!c.nextTouchDate)c.nextTouchDate=c.followUpDate||nextTouchDate(c.touchFrequency||DEFAULT_TOUCH_DAYS);
      }
    });
  }

  function removeChecklistAndLossTabs(){
    document.querySelectorAll('.md-tab').forEach(tab=>{
      const text=(tab.textContent||'').trim().toLowerCase();
      if(text.includes('чек-лист')||text.includes('клиент сливается'))tab.remove();
    });
    document.getElementById('mtab-checklist')?.remove();
    document.getElementById('mtab-loss')?.remove();
    document.querySelectorAll('button').forEach(button=>{
      const text=(button.textContent||'').trim().toLowerCase();
      if(text.includes('клиент сливается'))button.remove();
    });
  }

  function cardNextAction(c){
    if(c.nextTouchDate)return `связаться с клиентом · касание ${c.nextTouchDate}`;
    return 'связаться с клиентом';
  }

  function activeCard(c){
    const p=progress(c);
    const m=ageMin(c);
    const timeCls=m>60?'danger':m>30?'warn':'';
    return `<div class="deal-card" data-client-id="${esc(c.id)}" style="--p:${p.pct}%" data-onclick="openClient('${esc(c.id)}')">
      <div class="deal-top"><div>
        <div class="deal-name">${esc(c.name)}</div>
        <div class="deal-amt">${c.amount?fmt(c.amount)+' ₽':'сумма не указана'}</div>
        <div class="contact-mini">${c.phone?`<span class="contact-pill">${esc(c.phone)}</span>`:''}${c.username?`<span class="contact-pill">${esc(c.username)}</span>`:''}</div>
      </div><div class="deal-time ${timeCls}">${ageLabel(c)}</div></div>
      <div class="deal-meta"><span class="deal-pill">${esc(c.city||'')}</span><span class="deal-pill">${esc(c.category||'Криптообмен')}</span><span class="deal-pill">${c.direction==='sell'?'выдаём ₽':'выдаём USDT'}</span><span class="deal-pill">${p.done}/${p.total}</span></div>
      <div class="deal-progress"><div class="deal-progress-fill" style="width:${p.pct}%"></div></div>
      <div class="deal-next">Следующее: ${cardNextAction(c)}</div>
    </div>`;
  }

  function boardColumn(title,list){
    return `<div class="live-col"><div class="live-col-head"><div class="live-col-title">${title}</div><div class="live-count">${list.length}</div></div>${list.map(activeCard).join('')||'<div class="empty-col">Пусто</div>'}</div>`;
  }

  const previousNormalizeAll=window.normalizeAll||normalizeAll;
  window.normalizeAll=function(){
    previousNormalizeAll?.();
    normalizeRemovedLossStage();
  };

  window.losingList=function(){return[]};
  window.activeList=function(){
    normalizeRemovedLossStage();
    return visibleClients().filter(c=>openStages().includes(c.stage));
  };
  window.touchDueList=function(){
    normalizeRemovedLossStage();
    return visibleClients().filter(c=>openStages().includes(c.stage)&&c.nextTouchDate&&c.nextTouchDate<=today());
  };
  window.stageRu=function(stage){
    return ({active:'В работе',losing:'В работе',done:'Завершено',lost:'Потеряно'}[stage]||stage||'');
  };
  window.openLossMode=function(){};

  const previousSwitchTab=window.switchTab||switchTab;
  window.switchTab=function(id,el){
    if(id==='checklist'||id==='loss'){
      const calcTab=[...document.querySelectorAll('.md-tab')].find(tab=>(tab.textContent||'').trim()==='Калькулятор');
      return previousSwitchTab('calc',calcTab);
    }
    return previousSwitchTab(id,el);
  };

  const previousOpenClient=window.openClient||openClient;
  window.openClient=function(id){
    previousOpenClient(id);
    removeChecklistAndLossTabs();
    const calcTab=[...document.querySelectorAll('.md-tab')].find(tab=>(tab.textContent||'').trim()==='Калькулятор');
    switchTab('calc',calcTab);
  };

  window.renderCRM=function(){
    const board=document.getElementById('crm-board');
    if(!board)return;
    normalizeAll();
    const q=(document.getElementById('crm-search')?.value||'').toLowerCase();
    const city=document.getElementById('filter-city')?.value||'';
    const source=visibleClients();
    const filt=c=>(!city||c.city===city)&&(!q||[
      c.name,c.phone,c.username,c.city,c.source,c.category,c.assignedTo,managerName(c.assignedTo)
    ].join(' ').toLowerCase().includes(q));
    const dueIds=new Set(touchDueList().map(c=>c.id));
    const active=activeList().filter(c=>!dueIds.has(c.id)).filter(filt).sort((a,b)=>ageMin(b)-ageMin(a));
    const touch=touchDueList().filter(filt).sort((a,b)=>(a.nextTouchDate||'').localeCompare(b.nextTouchDate||''));
    const done=source.filter(c=>c.stage==='done').filter(filt).slice(0,12);
    const liveRub=source.filter(c=>!['done','lost'].includes(c.stage)).reduce((s,c)=>s+Number(c.amount||0),0);
    document.getElementById('live-money-box').innerHTML=`<div class="live-money-main">${fmt(liveRub)} ₽</div><div class="live-money-sub">${accessNotice()} · ${activeList().length} активных · ${touch.length} ждут касания</div>`;
    board.innerHTML=`${boardColumn('В работе',active)}${boardColumn('Касания',touch)}${boardColumn('Завершено',done)}`;
    const badge=document.getElementById('remind-badge');
    if(badge){badge.style.display=touch.length?'':'none';badge.textContent=String(touch.length)}
    window.updateChatsBadge?.();
    window.connectChatWebSocket?.();
    window.sendChatWatch?.();
  };

  const style=document.createElement('style');
  style.textContent='.live-board{grid-template-columns:repeat(3,minmax(0,1fr))}.atom-status-badge.losing{background:rgba(98,199,118,.14);border-color:rgba(98,199,118,.3);color:var(--green)}';
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded',()=>{
    normalizeRemovedLossStage();
    window.renderCRM?.();
  });
})();

(function(){
  function productManagers(){
    return managerRows().filter(u=>u.login&&u.login!=='boss');
  }

  window.stageRu=function(stage){
    return ({active:'В работе',losing:'В работе',done:'Завершено',lost:'Потеряно'}[stage]||stage||'');
  };

  window.analyticsHtml=function(list){
    const active=list.filter(c=>c.stage==='active'||c.stage==='losing');
    const done=list.filter(c=>c.stage==='done');
    const lost=list.filter(c=>c.stage==='lost');
    const openAmount=active.reduce((s,c)=>s+Number(c.amount||0),0);
    const closedAmount=done.reduce((s,c)=>s+Number(c.amount||0),0);
    const due=touchDueList().filter(c=>isBoss()||c.assignedTo===profile?.login).length;
    return `<div class="dash-mini-grid" style="grid-template-columns:repeat(6,1fr)">
      ${metric('Клиенты',list.length,'в базе',100)}
      ${metric('В работе',active.length,'открытые',list.length?active.length/list.length*100:0)}
      ${metric('Касания',due,'сегодня/просрочено',60)}
      ${metric('Завершено',done.length,'успешные',list.length?done.length/list.length*100:0)}
      ${metric('Оборот в работе',crmMoney(openAmount),'открытые сделки',70)}
      ${metric('Закрытый оборот',crmMoney(closedAmount),'успешные сделки',80)}
    </div>`;
  };

  window.telegramStatusPanel=function(settings){
    const connected=settings?.telegramSessionStatus==='configured';
    return `<div class="tg-status-panel ${connected?'ok':'bad'}">
      <div class="tg-status-dot"></div>
      <div><b>${connected?'Telegram подключен':'Telegram не подключен'}</b><span>${connected?'Можно писать клиентам и подтягивать историю чатов.':'Введите номер, получите код в Telegram и подключите аккаунт.'}</span></div>
    </div>`;
  };

  window.telegramSettingsCard=function(login){
    const settings=atomTelegramSettings.find(s=>s.managerLogin===login)||{managerLogin:login,telegramAccount:'',telegramSessionStatus:'not_configured',telegramSessionHint:''};
    const canEdit=login===profile?.login;
    return `<div class="card"><div class="card-title">Telegram: ${esc(managerName(login))}</div>
      ${telegramStatusPanel(settings)}
      <div class="fg2">
        <div><div class="fl">Телефон Telegram</div><input class="fi" id="tglogin-phone-${esc(login)}" placeholder="+79001234567"></div>
        <div><div class="fl">Код из Telegram</div><input class="fi" id="tglogin-code-${esc(login)}" placeholder="12345"></div>
      </div>
      <div class="fg2" style="margin-top:10px">
        <div><div class="fl">Подпись менеджера</div><input class="fi" id="tgset-account-${esc(login)}" value="${esc(settings.telegramAccount||'')}" placeholder="@manager"></div>
        <div><div class="fl">Пароль 2FA, если включен</div><input class="fi" id="tglogin-password-${esc(login)}" type="password" placeholder="не обязательно"></div>
      </div>
      <input type="hidden" id="tglogin-flow-${esc(login)}">
      <div class="sync-state" id="tglogin-state-${esc(login)}">Статус: ${settings?.telegramSessionStatus==='configured'?'подключен':'не подключен'}</div>
      ${canEdit?`<div class="quick-actions"><button class="btn btn-b" data-onclick="saveTelegramSettings('${login}')">Сохранить подпись</button><button class="btn btn-g" data-onclick="startTelegramAuth('${login}')">Получить код</button><button class="btn" data-onclick="completeTelegramAuth('${login}')">Подключить</button><button class="btn btn-r" data-onclick="disconnectTelegramSession('${login}')">Отключить</button></div>`:''}
    </div>`;
  };

  function teamGuideHtml(){
    return '';
  }

  function productBossUsersHtml(){
    return `<div class="card"><div class="card-title">Учетки менеджеров</div>
      <div class="fg3" style="margin-bottom:10px">
        <div><div class="fl">Логин</div><input class="fi" id="adm-login" placeholder="manager_login"></div>
        <div><div class="fl">Имя</div><input class="fi" id="adm-name" placeholder="Имя менеджера"></div>
        <div><div class="fl">Пароль</div><input class="fi" id="adm-pass" type="password" placeholder="новый пароль"></div>
      </div>
      <div class="fg2">
        <div><div class="fl">Город</div><input class="fi" id="adm-city" placeholder="Уфа"></div>
        <div><div class="fl">Роль</div><input class="fi" id="adm-role" value="CRM / менеджер"></div>
      </div>
      <div class="quick-actions"><button class="btn btn-g" data-onclick="saveManagedUser()">Создать / обновить</button></div>
      <div class="chat-list" style="margin-top:12px">${productManagers().map(u=>`<div class="chat-item"><div><b>${esc(u.name)}</b><div class="archive-meta">${esc(u.city)} · login: ${esc(u.login)}</div><div class="archive-meta">Клиентов: ${u.total} · В работе: ${u.active} · Закрыто: ${u.done}</div></div><div class="quick-actions" style="margin-top:0"><button class="btn btn-b btn-xs" data-onclick="fillManagedUser('${u.login}')">Изменить</button><button class="btn btn-b btn-xs" data-onclick="changeUserPassword('${u.login}')">Пароль</button><button class="btn btn-r btn-xs" data-onclick="deleteManagedUser('${u.login}')">Удалить</button></div></div>`).join('')}</div>
    </div>`;
  }

  window.renderCabinet=function(){
    const root=document.getElementById('cabinet-content');
    if(!root)return;
    const list=visibleForStats();
    if(isBoss()){
      root.innerHTML=`<div class="card"><div class="card-title">Boss кабинет</div><p>Все клиенты, статистика, журнал действий, учетные записи и подключение Telegram.</p></div>
        ${analyticsHtml(list)}
        <div class="cab-grid"><div>${productBossUsersHtml()}</div><div>${telegramSettingsCard('boss')}</div></div>
        <div class="card"><div class="card-title">Клиенты в CRM</div>${clientsTableHtml(list)}</div>
        ${auditHtml()}`;
    }else{
      root.innerHTML=`<div class="card"><div class="card-title">Личный кабинет</div><div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(profile?.role||'CRM / менеджер')} · ${esc(profile?.city||'')} · login: ${esc(profile?.login||'')}</div></div></div></div>
        ${analyticsHtml(list)}
        ${telegramSettingsCard(profile?.login)}
        <div class="card"><div class="card-title">Мои клиенты</div>${clientsTableHtml(list)}</div>
        ${auditHtml()}`;
    }
  };

  function renderBossAssignBox(c){
    document.getElementById('boss-assign-box')?.remove();
    if(!isBoss()||!c)return;
    const head=document.querySelector('#client-modal .md-head');
    if(!head)return;
    head.insertAdjacentHTML('afterend',`<div class="card" id="boss-assign-box" style="margin:10px 14px 0">
      <div class="fg2" style="align-items:end">
        <div><div class="fl">Ответственный менеджер</div><select class="fs" id="boss-assign-select">${managerSelectOptions(c.assignedTo)}</select></div>
        <div><button class="btn btn-g" data-onclick="assignClientToManager()">Передать клиента</button></div>
      </div>
    </div>`);
  }

  window.assignClientToManager=async function(){
    const c=clients.find(x=>String(x.id)===String(activeClientId));
    const next=document.getElementById('boss-assign-select')?.value;
    if(!c||!next)return;
    const previous=c.assignedTo;
    c.assignedTo=next;
    save();
    logAction('Передал клиента',c,`${managerName(previous)} -> ${managerName(next)}`);
    try{await syncClientsToBackendNow()}catch(e){console.warn('Assign sync failed:',e.message)}
    document.getElementById('cm-meta').textContent=`${c.city} · ${c.phone||'телефон не указан'} · ${c.username||'username не указан'} · ${c.category} · ${managerName(c.assignedTo)}`;
    renderCRM();
    renderCabinet();
    atomToast?.('Клиент передан: '+managerName(next));
  };

  const previousLoadInfo=window.loadInfo||loadInfo;
  window.loadInfo=function(c){
    previousLoadInfo(c);
    const tab=document.getElementById('mtab-info');
    if(!tab||!c)return;
    tab.querySelector('.product-client-summary')?.remove();
    tab.insertAdjacentHTML('afterbegin',`<div class="card product-client-summary">
      <div class="card-title">Карточка клиента</div>
      <div class="dash-mini-grid" style="grid-template-columns:repeat(4,1fr)">
        ${metric('Статус',stageRu(c.stage),'текущий',70)}
        ${metric('Сумма',crmMoney(c.amount),'сделка',70)}
        ${metric('Ответственный',managerName(c.assignedTo),'менеджер',70)}
        ${metric('Касание',formatExportDate?formatExportDate(c.nextTouchDate):c.nextTouchDate||'не назначено','следующее',60)}
      </div>
    </div>`);
  };

  const previousOpenClient=window.openClient||openClient;
  window.openClient=function(id){
    previousOpenClient(id);
    const c=clients.find(x=>String(x.id)===String(activeClientId));
    renderBossAssignBox(c);
    removeProductNoise();
    const infoTab=[...document.querySelectorAll('.md-tab')].find(tab=>(tab.textContent||'').trim()==='Инфо');
    if(infoTab)window.switchTab('info',infoTab);
  };

  window.renderTelegramClient=function(c){
    const root=document.getElementById('telegram-client-content');
    if(!root||!c)return;
    const username=String(chatUsername(c)||'').replace('@','');
    root.innerHTML=`<div class="card">
      <div class="card-title">Telegram клиента</div>
      <div class="fg2">
        <div><div class="fl">Имя чата</div><input class="fi" id="tg-client-title" value="${esc(c.telegramChat?.title||c.name||'')}"></div>
        <div><div class="fl">Username клиента</div><input class="fi" id="tg-client-username" value="${esc(c.telegramChat?.username||c.username||'')}" placeholder="@username"></div>
      </div>
      <div class="atom-chat-history" id="modal-tg-history">${chatMessagesHtml(c)}</div>
      <div class="atom-chat-composer">
        <div class="msg-lbl">Сообщение менеджера</div>
        <textarea class="fi" id="tg-draft" rows="4" placeholder="Напишите сообщение. Enter - отправить, Shift+Enter - новая строка"></textarea>
        <div class="quick-actions">
          <button class="btn btn-g" id="send-telegram-message" data-onclick="sendTelegramDraft(this)">Отправить в Telegram</button>
          <button class="btn btn-b" data-onclick="linkAndImportTelegram(this)">Обновить историю</button>
          ${username?`<button class="btn" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}
        </div>
        <div class="sync-state">Для связи у клиента должен быть указан username.</div>
      </div>
    </div>`;
    scrollChatToBottom?.('modal-tg-history');
    window.connectChatWebSocket?.();
    window.sendChatWatch?.();
  };

  function removeProductNoise(){
    document.querySelectorAll('.auth-hint').forEach(el=>{el.textContent='';el.style.display='none'});
    document.getElementById('local-backend-card')?.remove();
    document.getElementById('warp-status-card')?.remove();
    document.querySelectorAll('.sync-state').forEach(el=>{
      const text=(el.textContent||'').toLowerCase();
      if(text.includes('postgres')||text.includes('backend импортирует')||text.includes('mtproto')||text.includes('session')||text.includes('proxy'))el.remove();
    });
  }

  const productStyle=document.createElement('style');
  productStyle.textContent=`
    .auth-hint{display:none!important}
    #local-backend-card,#warp-status-card{display:none!important}
    .live-board{grid-template-columns:repeat(3,minmax(0,1fr))}
    .tg-status-panel span{display:block;margin-top:3px}
  `;
  document.head.appendChild(productStyle);

  document.addEventListener('DOMContentLoaded',async()=>{
    removeProductNoise();
    if(authToken&&profile){
      clients=[];
      __backendLoaded=false;
      await loadClientsFromBackend();
      if(authToken&&profile)bootApp();
    }
    if(document.getElementById('page-cabinet')?.classList.contains('active'))renderCabinet();
  });
})();

(function(){
  function atomSum(list, predicate){
    return (list||[]).filter(predicate||(()=>true)).reduce((sum, client)=>sum+Number(client.amount||0),0);
  }

  function atomPct(value,total){
    return total ? Math.round(value / total * 100) : 0;
  }

  function atomStageLabel(stage){
    return ({active:'В работе',losing:'На дожиме',done:'Завершено',lost:'Потеряно'}[stage]||stage||'');
  }

  function atomGroupRows(list, field, title, limit=6){
    const groups = {};
    (list||[]).forEach(client=>{
      const key = String(client[field] || 'Не указано');
      groups[key] ||= { name:key, count:0, amount:0 };
      groups[key].count += 1;
      groups[key].amount += Number(client.amount||0);
    });
    const rows = Object.values(groups).sort((a,b)=>b.count-a.count).slice(0,limit);
    const max = Math.max(1,...rows.map(row=>row.count));
    return `<div class="card atom-collapse-card"><div class="card-title">${esc(title)}</div>
      ${rows.map(row=>`<div class="stat-bar-row">
        <div class="stat-bar-name">${esc(row.name)}</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.max(5,row.count/max*100)}%"></div></div>
        <div class="stat-bar-val">${row.count} · ${crmMoney(row.amount)}</div>
      </div>`).join('') || '<div class="empty-col">Пока нет данных</div>'}
    </div>`;
  }

  function atomBossStatsHtml(list){
    const all = list || [];
    const active = all.filter(c=>c.stage==='active');
    const losing = all.filter(c=>c.stage==='losing');
    const done = all.filter(c=>c.stage==='done');
    const lost = all.filter(c=>c.stage==='lost');
    const openAmount = atomSum([...active,...losing]);
    const doneAmount = atomSum(done);
    const totalAmount = atomSum(all, c=>c.stage!=='lost');
    const closedTotal = done.length + lost.length;
    const avg = all.length ? Math.round(atomSum(all) / all.length) : 0;
    const due = touchDueList().length;
    const tgLinked = all.filter(c=>window.chatUsername?.(c) || c.telegramChat?.chatId).length;
    return `<div class="atom-boss-stats">
      <div class="dash-mini-grid atom-stats-grid">
        ${metric('Всего клиентов', all.length, 'в базе CRM', 100)}
        ${metric('В работе', active.length + losing.length, 'активные сделки', atomPct(active.length+losing.length, all.length))}
        ${metric('Касания', due, 'сегодня/просрочено', Math.min(100,due*12))}
        ${metric('Конверсия', atomPct(done.length, closedTotal)+'%', 'успешные / закрытые', atomPct(done.length, closedTotal))}
        ${metric('Открытый объем', crmMoney(openAmount), 'в работе + дожим', 72)}
        ${metric('Завершенный объем', crmMoney(doneAmount), 'успешные сделки', 82)}
        ${metric('Общий объем', crmMoney(totalAmount), 'без потерянных', 85)}
        ${metric('Средний чек', crmMoney(avg), 'по всем клиентам', 58)}
        ${metric('Telegram', tgLinked, 'клиентов с username/chat', atomPct(tgLinked, all.length))}
      </div>
      <div class="cab-grid atom-stats-breakdown">
        ${atomManagerStatsHtml()}
        <div>
          ${atomGroupRows(all,'city','Города')}
          ${atomGroupRows(all,'category','Категории')}
        </div>
      </div>
    </div>`;
  }

  function atomManagerStatsHtml(){
    const rows = managerRows().sort((a,b)=>b.amount-a.amount);
    const maxAmount = Math.max(1,...rows.map(row=>row.amount));
    return `<div class="card atom-collapse-card"><div class="card-title">Менеджеры</div>
      ${rows.map(row=>`<div class="atom-manager-row">
        <div>
          <b>${esc(row.name||row.login)}</b>
          <div class="archive-meta">${esc(row.city||'')} · клиентов ${row.total} · в работе ${row.active + row.losing} · завершено ${row.done}</div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.max(5,row.amount/maxAmount*100)}%"></div></div>
        </div>
        <span class="contact-pill">${crmMoney(row.amount)}</span>
      </div>`).join('') || '<div class="empty-col">Менеджеры пока не созданы</div>'}
    </div>`;
  }

  function atomBossUsersHtml(){
    const rows = managerRows();
    return `<div class="card"><div class="card-title">Учетки менеджеров</div>
      <div class="fg3" style="margin-bottom:10px">
        <div><div class="fl">Логин</div><input class="fi" id="adm-login" placeholder="manager_login"></div>
        <div><div class="fl">Имя</div><input class="fi" id="adm-name" placeholder="Имя менеджера"></div>
        <div><div class="fl">Пароль</div><input class="fi" id="adm-pass" type="password" placeholder="новый пароль"></div>
      </div>
      <div class="fg2">
        <div><div class="fl">Город</div><input class="fi" id="adm-city" placeholder="Уфа"></div>
        <div><div class="fl">Роль</div><input class="fi" id="adm-role" value="CRM / менеджер"></div>
      </div>
      <div class="quick-actions"><button class="btn btn-g" data-onclick="saveManagedUser()">Создать / обновить</button></div>
      <div class="chat-list" style="margin-top:12px">${rows.map(u=>`<div class="chat-item">
        <div><b>${esc(u.name||u.login)}</b><div class="archive-meta">${esc(u.city||'')} · login: ${esc(u.login)}</div><div class="archive-meta">Клиентов: ${u.total} · В работе: ${u.active+u.losing} · Завершено: ${u.done}</div></div>
        <div class="quick-actions" style="margin-top:0"><button class="btn btn-b btn-xs" data-onclick="fillManagedUser('${esc(u.login)}')">Изменить</button><button class="btn btn-b btn-xs" data-onclick="changeUserPassword('${esc(u.login)}')">Пароль</button><button class="btn btn-r btn-xs" data-onclick="deleteManagedUser('${esc(u.login)}')">Удалить</button></div>
      </div>`).join('') || '<div class="empty-col">Менеджеры пока не созданы</div>'}</div>
    </div>`;
  }

  function atomDetails(title, body, options={}){
    return `<details class="atom-details" ${options.open?'open':''}>
      <summary><span>${esc(title)}</span><span class="atom-details-hint">${options.hint ? esc(options.hint) : 'Открыть'}</span></summary>
      <div class="atom-details-body">${body}</div>
    </details>`;
  }

  function atomCleanAuditRows(){
    const raw = (atomAuditLogs.length ? atomAuditLogs : bossLogRows())
      .filter(row=>{
        const action = String(row.action||'');
        return !action.includes('Синхронизировал клиентов') && !action.includes('Импортировал Telegram-историю');
      });
    const seen = new Set();
    return raw.filter(row=>{
      const action = String(row.action||'');
      const created = String(row.createdAt||row.date||'').slice(0,13);
      const key = [action,row.managerLogin||row.manager,row.clientId||row.clientName,row.details,created].join('|');
      if(action.includes('Импортировал Telegram-историю') && seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0,50);
  }

  window.auditHtml = function(){
    const rows = atomCleanAuditRows();
    return `<div class="chat-list atom-audit-list">
      ${rows.map(row=>`<div class="chat-item atom-audit-row">
        <div>
          <b>${esc(row.action||'Действие')}</b>
          <div class="archive-meta">${esc(managerName(row.managerLogin||row.manager))} · ${esc(row.clientName||'')} · ${esc(String(row.createdAt||row.date||'').replace('T',' ').slice(0,16))}</div>
          ${row.details?`<div class="archive-meta">${esc(row.details)}</div>`:''}
        </div>
      </div>`).join('') || '<div class="empty-col">Журнал пока пуст</div>'}
    </div>`;
  };

  window.renderCabinet = function(){
    const root=document.getElementById('cabinet-content');
    if(!root)return;
    const list=visibleForStats();
    if(isBoss()){
      root.innerHTML=`<div class="card atom-hero-card">
          <div class="card-title">Boss панель</div>
          <p>Главная статистика, контроль менеджеров и журнал действий. Подробные блоки свернуты, чтобы кабинет не превращался в простыню.</p>
        </div>
        ${atomBossStatsHtml(list)}
        ${atomDetails('Клиенты в CRM', clientsTableHtml(list), {hint:String(list.length), open:false})}
        ${atomDetails('Учетки менеджеров', atomBossUsersHtml(), {hint:String(managerRows().length), open:false})}
        ${atomDetails('Telegram Boss', telegramSettingsCard('boss'), {hint:(atomTelegramSettings.find(s=>s.managerLogin==='boss')?.telegramSessionStatus==='configured'?'Подключен':'Не подключен'), open:false})}
        ${atomDetails('Журнал действий', auditHtml(), {hint:String(atomCleanAuditRows().length), open:false})}`;
    }else{
      root.innerHTML=`<div class="card atom-hero-card">
          <div class="card-title">Личный кабинет</div>
          <div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(profile?.role||'CRM / менеджер')} · ${esc(profile?.city||'')} · login: ${esc(profile?.login||'')}</div></div></div>
        </div>
        ${analyticsHtml(list)}
        ${atomDetails('Telegram подключение', telegramSettingsCard(profile?.login), {hint:(atomTelegramSettings.find(s=>s.managerLogin===profile?.login)?.telegramSessionStatus==='configured'?'Подключен':'Не подключен'), open:true})}
        ${atomDetails('Мои клиенты', clientsTableHtml(list), {hint:String(list.length), open:false})}
        ${atomDetails('Журнал действий', auditHtml(), {hint:String(atomCleanAuditRows().length), open:false})}`;
    }
  };

  const atomUxStyle=document.createElement('style');
  atomUxStyle.textContent=`
    .atom-hero-card p{color:var(--muted);font-size:12px;line-height:1.6;margin:8px 0 0}
    .atom-stats-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px}
    .atom-stats-breakdown{align-items:start}
    .atom-manager-row{display:grid;grid-template-columns:minmax(0,1fr)auto;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--border)}
    .atom-manager-row:last-child{border-bottom:0}
    .atom-manager-row .stat-bar-track{margin-top:8px}
    .atom-details{background:var(--bg2);border:1px solid var(--border);border-radius:12px;margin:12px 0;overflow:hidden}
    .atom-details[open]{border-color:rgba(201,168,76,.34)}
    .atom-details summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 18px;color:var(--gold);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
    .atom-details summary::-webkit-details-marker{display:none}
    .atom-details summary:after{content:'+';width:26px;height:26px;border:1px solid var(--border);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--gold);font-size:16px}
    .atom-details[open] summary:after{content:'−'}
    .atom-details-hint{margin-left:auto;color:var(--muted);font-size:10px;text-transform:none;letter-spacing:0;font-weight:600}
    .atom-details-body{padding:0 16px 16px}
    .atom-details-body>.card{margin:0;border-color:transparent;background:transparent;padding:0}
    .atom-audit-list{max-height:420px;overflow:auto;padding-right:4px}
    .atom-audit-row{align-items:flex-start}
    @media(max-width:1100px){.atom-stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.atom-stats-breakdown{grid-template-columns:1fr}}
  `;
  document.head.appendChild(atomUxStyle);
})();

(function(){
  function statsList(){
    return isBoss() ? (clients||[]) : visibleForStats();
  }

  function stageLabel(stage){
    return ({active:'В работе',losing:'На дожиме',done:'Завершено',lost:'Потеряно'}[stage]||stage||'В работе');
  }

  function groupStatRows(list, field){
    const rows = {};
    (list||[]).forEach(client=>{
      const key = String(client[field] || 'Не указано');
      rows[key] ||= {name:key,total:0,active:0,losing:0,done:0,lost:0,amount:0,doneAmount:0};
      const row = rows[key];
      row.total += 1;
      row[client.stage] = Number(row[client.stage]||0) + 1;
      row.amount += Number(client.amount||0);
      if(client.stage==='done') row.doneAmount += Number(client.amount||0);
    });
    return Object.values(rows).sort((a,b)=>b.amount-a.amount || b.total-a.total);
  }

  function statPanel(title, rows){
    const max = Math.max(1,...rows.map(row=>row.amount));
    return `<div class="card atom-stat-panel">
      <div class="card-title">${esc(title)}</div>
      <div class="atom-stat-table">
        <div class="atom-stat-head">
          <span>Название</span><span>Клиенты</span><span>В работе</span><span>Завершено</span><span>Оборот</span>
        </div>
        ${rows.map(row=>`<div class="atom-stat-line">
          <div>
            <b>${esc(row.name)}</b>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.max(5,row.amount/max*100)}%"></div></div>
          </div>
          <span>${row.total}</span>
          <span>${row.active + row.losing}</span>
          <span>${row.done}</span>
          <span>${crmMoney(row.amount)}</span>
        </div>`).join('') || '<div class="empty-col">Данных пока нет</div>'}
      </div>
    </div>`;
  }

  function renderStatsPage(){
    ensureBossWorkTabs();
    const root=document.getElementById('stats-content');
    if(!root)return;
    const list=statsList();
    const active=list.filter(c=>c.stage==='active'||c.stage==='losing');
    const done=list.filter(c=>c.stage==='done');
    const lost=list.filter(c=>c.stage==='lost');
    root.innerHTML=`<div class="card atom-hero-card">
      <div class="card-title">Подробная статистика</div>
      <p>Разбивка по городам, категориям и менеджерам. Boss видит все сделки, менеджер видит только свои.</p>
    </div>
    <div class="dash-mini-grid atom-stats-grid">
      ${metric('Всего клиентов', list.length, 'в CRM', 100)}
      ${metric('Активные', active.length, 'в работе', list.length?active.length/list.length*100:0)}
      ${metric('Завершено', done.length, 'успешно', list.length?done.length/list.length*100:0)}
      ${metric('Потеряно', lost.length, 'архив потерь', list.length?lost.length/list.length*100:0)}
      ${metric('Оборот', crmMoney(list.reduce((s,c)=>s+Number(c.amount||0),0)), 'все сделки', 78)}
      ${metric('Успешный оборот', crmMoney(done.reduce((s,c)=>s+Number(c.amount||0),0)), 'закрытые сделки', 68)}
    </div>
    <div class="atom-stats-page-grid">
      ${statPanel('Города', groupStatRows(list,'city'))}
      ${statPanel('Категории', groupStatRows(list,'category'))}
    </div>
    ${isBoss()?`<div class="atom-stats-page-grid single">${statPanel('Менеджеры', managerRows().sort((a,b)=>b.amount-a.amount).map(row=>({
      name: row.name || row.login,
      total: row.total,
      active: row.active,
      losing: row.losing,
      done: row.done,
      lost: row.lost,
      amount: row.amount,
      doneAmount: row.amount
    })))}</div>`:''}`;
  }

  function managerClientPreview(login){
    return (clients||[])
      .filter(client=>client.assignedTo===login)
      .slice(0,8)
      .map(client=>`<tr data-onclick="openClient('${esc(client.id)}')">
        <td><b>${esc(client.name)}</b><div class="archive-meta">${esc(client.username||client.phone||'контакт не указан')}</div></td>
        <td>${esc(client.city||'')}</td>
        <td>${esc(client.category||'')}</td>
        <td>${crmMoney(client.amount)}</td>
        <td><span class="atom-status-badge ${esc(client.stage||'active')}">${esc(stageLabel(client.stage))}</span></td>
      </tr>`).join('') || '<tr><td colspan="5"><div class="empty-col">Клиентов пока нет</div></td></tr>';
  }

  function renderManagersPage(){
    ensureBossWorkTabs();
    const root=document.getElementById('managers-content');
    if(!root)return;
    if(!isBoss()){
      root.innerHTML='<div class="card"><div class="card-title">Менеджеры</div><div class="empty-col">Эта вкладка доступна Boss.</div></div>';
      return;
    }
    const rows=managerRows().sort((a,b)=>b.amount-a.amount);
    root.innerHTML=`<div class="card atom-hero-card">
      <div class="card-title">Менеджеры</div>
      <p>Сводка по каждому менеджеру: активные клиенты, завершенные сделки, оборот и быстрый просмотр клиентов.</p>
    </div>
    <div class="atom-manager-tabs">
      ${rows.map(row=>`<details class="atom-details atom-manager-detail">
        <summary>
          <span>${esc(row.name||row.login)}</span>
          <span class="atom-details-hint">${row.total} клиентов · ${crmMoney(row.amount)}</span>
        </summary>
        <div class="atom-details-body">
          <div class="dash-mini-grid atom-manager-metrics">
            ${metric('Клиенты', row.total, 'в CRM', 100)}
            ${metric('В работе', row.active + row.losing, 'активные', row.total?(row.active+row.losing)/row.total*100:0)}
            ${metric('Завершено', row.done, 'успешно', row.total?row.done/row.total*100:0)}
            ${metric('Оборот', crmMoney(row.amount), esc(row.city||''), 72)}
          </div>
          <div class="atom-table-wrap"><table class="atom-table">
            <thead><tr><th>Клиент</th><th>Город</th><th>Категория</th><th>Сумма</th><th>Статус</th></tr></thead>
            <tbody>${managerClientPreview(row.login)}</tbody>
          </table></div>
        </div>
      </details>`).join('') || '<div class="card"><div class="empty-col">Менеджеры пока не созданы</div></div>'}
    </div>`;
  }

  function ensureBossWorkTabs(){
    const nav=document.querySelector('.sb-nav');
    const content=document.querySelector('.content');
    if(!nav||!content)return;
    if(!document.getElementById('sb-stats-link')){
      const archive=[...document.querySelectorAll('.sb-item')].find(el=>(el.textContent||'').includes('Архив'));
      const html=`<div class="sb-item" id="sb-stats-link" data-onclick="showPage('stats',this)">▤ Статистика</div>
        <div class="sb-item" id="sb-managers-link" data-onclick="showPage('managers',this)">▥ Менеджеры</div>`;
      if(archive) archive.insertAdjacentHTML('afterend',html);
      else nav.insertAdjacentHTML('beforeend',html);
    }
    document.getElementById('sb-managers-link')?.classList.toggle('hidden-boss-tab',!isBoss());
    if(!document.getElementById('page-stats')) content.insertAdjacentHTML('beforeend','<section class="page" id="page-stats"><div id="stats-content"></div></section>');
    if(!document.getElementById('page-managers')) content.insertAdjacentHTML('beforeend','<section class="page" id="page-managers"><div id="managers-content"></div></section>');
  }

  const showPageBeforeStats=window.showPage||showPage;
  window.showPage=function(id,el){
    if(id==='stats'||id==='managers'){
      ensureBossWorkTabs();
      document.querySelectorAll('.page').forEach(page=>page.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(item=>item.classList.remove('active'));
      document.getElementById('page-'+id)?.classList.add('active');
      (el||document.getElementById(id==='stats'?'sb-stats-link':'sb-managers-link'))?.classList.add('active');
      const title=document.getElementById('topbar-title');
      if(title) title.textContent=id==='stats'?'Статистика':'Менеджеры';
      if(id==='stats')renderStatsPage();
      if(id==='managers')renderManagersPage();
      return;
    }
    showPageBeforeStats(id,el);
  };
  try{showPage=window.showPage}catch(_){}

  const bootBeforeStats=window.bootApp||bootApp;
  window.bootApp=function(){
    bootBeforeStats();
    ensureBossWorkTabs();
  };
  try{bootApp=window.bootApp}catch(_){}

  const renderCrmBeforeStats=window.renderCRM||renderCRM;
  window.renderCRM=function(){
    renderCrmBeforeStats();
    ensureBossWorkTabs();
    if(document.getElementById('page-stats')?.classList.contains('active'))renderStatsPage();
    if(document.getElementById('page-managers')?.classList.contains('active'))renderManagersPage();
  };
  try{renderCRM=window.renderCRM}catch(_){}

  document.addEventListener('DOMContentLoaded',()=>setTimeout(ensureBossWorkTabs,400));

  const style=document.createElement('style');
  style.textContent=`
    .hidden-boss-tab{display:none!important}
    .atom-stats-page-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .atom-stats-page-grid.single{grid-template-columns:1fr;margin-top:14px}
    .atom-stat-panel{min-height:260px}
    .atom-stat-table{display:flex;flex-direction:column;gap:8px}
    .atom-stat-head,.atom-stat-line{display:grid;grid-template-columns:minmax(180px,1fr)90px 90px 100px 130px;gap:12px;align-items:center}
    .atom-stat-head{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);padding-bottom:8px}
    .atom-stat-line{padding:9px 0;border-bottom:1px solid var(--border);font-size:12px}
    .atom-stat-line:last-child{border-bottom:0}
    .atom-manager-detail summary{min-height:52px}
    .atom-manager-metrics{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px}
    @media(max-width:1100px){.atom-stats-page-grid{grid-template-columns:1fr}.atom-stat-head,.atom-stat-line{grid-template-columns:minmax(160px,1fr)70px 70px 80px 110px}.atom-manager-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
})();

(function(){
  function ensureCleanTabs(){
    const nav=document.querySelector('.sb-nav');
    const content=document.querySelector('.content');
    if(nav&&!document.getElementById('sb-stats-link')){
      const archive=[...document.querySelectorAll('.sb-item')].find(el=>(el.textContent||'').includes('Архив'));
      const html=`<div class="sb-item" id="sb-stats-link" data-onclick="showPage('stats',this)">▤ Статистика</div>`;
      if(archive)archive.insertAdjacentHTML('afterend',html);
      else nav.insertAdjacentHTML('beforeend',html);
    }
    document.getElementById('sb-managers-link')?.remove();
    if(content&&!document.getElementById('page-stats'))content.insertAdjacentHTML('beforeend','<section class="page" id="page-stats"><div id="stats-content"></div></section>');
    document.getElementById('page-managers')?.remove();
  }

  function stageLabelClean(stage){
    return ({active:'В работе',losing:'На дожиме',done:'Завершено',lost:'Потеряно'}[stage]||stage||'В работе');
  }

  function managerClientPreviewClean(login){
    return (clients||[])
      .filter(client=>client.assignedTo===login)
      .slice(0,8)
      .map(client=>`<tr data-onclick="openClient('${esc(client.id)}')">
        <td><b>${esc(client.name)}</b><div class="archive-meta">${esc(client.username||client.phone||'контакт не указан')}</div></td>
        <td>${esc(client.city||'')}</td>
        <td>${esc(client.category||'')}</td>
        <td>${crmMoney(client.amount)}</td>
        <td><span class="atom-status-badge ${esc(client.stage||'active')}">${esc(stageLabelClean(client.stage))}</span></td>
      </tr>`).join('') || '<tr><td colspan="5"><div class="empty-col">Клиентов пока нет</div></td></tr>';
  }

  function managersInsideStatsClean(){
    const rows=managerRows().sort((a,b)=>b.amount-a.amount);
    return `<div class="card atom-stat-panel">
      <div class="card-title">Менеджеры</div>
      <div class="atom-manager-tabs compact">
        ${rows.map(row=>`<details class="atom-details atom-manager-detail">
          <summary><span>${esc(row.name||row.login)}</span><span class="atom-details-hint">${row.total} клиентов · ${crmMoney(row.amount)}</span></summary>
          <div class="atom-details-body">
            <div class="dash-mini-grid atom-manager-metrics">
              ${metric('Клиенты', row.total, 'в CRM', 100)}
              ${metric('В работе', row.active + row.losing, 'активные', row.total?(row.active+row.losing)/row.total*100:0)}
              ${metric('Завершено', row.done, 'успешно', row.total?row.done/row.total*100:0)}
              ${metric('Оборот', crmMoney(row.amount), esc(row.city||''), 72)}
            </div>
            <div class="atom-table-wrap"><table class="atom-table">
              <thead><tr><th>Клиент</th><th>Город</th><th>Категория</th><th>Сумма</th><th>Статус</th></tr></thead>
              <tbody>${managerClientPreviewClean(row.login)}</tbody>
            </table></div>
          </div>
        </details>`).join('') || '<div class="empty-col">Менеджеры пока не созданы</div>'}
      </div>
    </div>`;
  }

  function groupRowsClean(list, field){
    const map={};
    (list||[]).forEach(client=>{
      const key=String(client[field]||'Не указано');
      map[key] ||= {name:key,total:0,active:0,losing:0,done:0,lost:0,amount:0};
      map[key].total++;
      map[key][client.stage]=Number(map[key][client.stage]||0)+1;
      map[key].amount += Number(client.amount||0);
    });
    return Object.values(map).sort((a,b)=>b.amount-a.amount||b.total-a.total);
  }

  function statPanelClean(title, rows){
    const max=Math.max(1,...rows.map(row=>row.amount));
    return `<div class="card atom-stat-panel">
      <div class="card-title">${esc(title)}</div>
      <div class="atom-stat-table">
        <div class="atom-stat-head"><span>Название</span><span>Клиенты</span><span>В работе</span><span>Завершено</span><span>Оборот</span></div>
        ${rows.map(row=>`<div class="atom-stat-line">
          <div><b>${esc(row.name)}</b><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.max(5,row.amount/max*100)}%"></div></div></div>
          <span>${row.total}</span><span>${row.active+row.losing}</span><span>${row.done}</span><span>${crmMoney(row.amount)}</span>
        </div>`).join('') || '<div class="empty-col">Данных пока нет</div>'}
      </div>
    </div>`;
  }

  window.renderStatsPage=function(){
    ensureCleanTabs();
    const root=document.getElementById('stats-content');
    if(!root)return;
    const list=isBoss()?(clients||[]):visibleForStats();
    const active=list.filter(c=>c.stage==='active'||c.stage==='losing');
    const done=list.filter(c=>c.stage==='done');
    const lost=list.filter(c=>c.stage==='lost');
    root.innerHTML=`<div class="card atom-hero-card">
      <div class="card-title">Подробная статистика</div>
      <p>Разбивка по городам, категориям и менеджерам. Вся статистика находится здесь, личный кабинет оставлен для настроек.</p>
    </div>
    <div class="dash-mini-grid atom-stats-grid">
      ${metric('Всего клиентов', list.length, 'в CRM', 100)}
      ${metric('Активные', active.length, 'в работе', list.length?active.length/list.length*100:0)}
      ${metric('Завершено', done.length, 'успешно', list.length?done.length/list.length*100:0)}
      ${metric('Потеряно', lost.length, 'архив потерь', list.length?lost.length/list.length*100:0)}
      ${metric('Оборот', crmMoney(list.reduce((s,c)=>s+Number(c.amount||0),0)), 'все сделки', 78)}
      ${metric('Успешный оборот', crmMoney(done.reduce((s,c)=>s+Number(c.amount||0),0)), 'закрытые сделки', 68)}
    </div>
    <div class="atom-stats-page-grid">
      ${statPanelClean('Города', groupRowsClean(list,'city'))}
      ${statPanelClean('Категории', groupRowsClean(list,'category'))}
    </div>
    ${isBoss()?`<div class="atom-stats-page-grid single">${managersInsideStatsClean()}</div>`:''}`;
  };

  function detailsClean(title, body, options={}){
    return `<details class="atom-details" ${options.open?'open':''}>
      <summary><span>${esc(title)}</span><span class="atom-details-hint">${options.hint?esc(options.hint):'Открыть'}</span></summary>
      <div class="atom-details-body">${body}</div>
    </details>`;
  }

  function bossUsersClean(){
    const rows=managerRows();
    return `<div class="card"><div class="card-title">Учетки менеджеров</div>
      <div class="fg3" style="margin-bottom:10px">
        <div><div class="fl">Логин</div><input class="fi" id="adm-login" placeholder="manager_login"></div>
        <div><div class="fl">Имя</div><input class="fi" id="adm-name" placeholder="Имя менеджера"></div>
        <div><div class="fl">Пароль</div><input class="fi" id="adm-pass" type="password" placeholder="новый пароль"></div>
      </div>
      <div class="fg2">
        <div><div class="fl">Город</div><input class="fi" id="adm-city" placeholder="Уфа"></div>
        <div><div class="fl">Роль</div><input class="fi" id="adm-role" value="CRM / менеджер"></div>
      </div>
      <div class="quick-actions"><button class="btn btn-g" data-onclick="saveManagedUser()">Создать / обновить</button></div>
      <div class="chat-list" style="margin-top:12px">${rows.map(u=>`<div class="chat-item">
        <div><b>${esc(u.name||u.login)}</b><div class="archive-meta">${esc(u.city||'')} · login: ${esc(u.login)}</div></div>
        <div class="quick-actions" style="margin-top:0"><button class="btn btn-b btn-xs" data-onclick="fillManagedUser('${esc(u.login)}')">Изменить</button><button class="btn btn-b btn-xs" data-onclick="changeUserPassword('${esc(u.login)}')">Пароль</button><button class="btn btn-r btn-xs" data-onclick="deleteManagedUser('${esc(u.login)}')">Удалить</button></div>
      </div>`).join('') || '<div class="empty-col">Менеджеры пока не созданы</div>'}</div>
    </div>`;
  }

  function cleanAuditRows(){
    const raw=(window.atomAuditLogs&&window.atomAuditLogs.length?window.atomAuditLogs:(typeof bossLogRows==='function'?bossLogRows():[]));
    return raw.filter(row=>{
      const action=String(row.action||'');
      return !action.includes('Синхронизировал клиентов')&&!action.includes('Импортировал Telegram-историю');
    }).slice(0,50);
  }

  function auditClean(){
    const rows=cleanAuditRows();
    return `<div class="chat-list atom-audit-list">${rows.map(row=>`<div class="chat-item atom-audit-row"><div>
      <b>${esc(row.action||'Действие')}</b>
      <div class="archive-meta">${esc(managerName(row.managerLogin||row.manager))} · ${esc(row.clientName||'')} · ${esc(String(row.createdAt||row.date||'').replace('T',' ').slice(0,16))}</div>
      ${row.details?`<div class="archive-meta">${esc(row.details)}</div>`:''}
    </div></div>`).join('') || '<div class="empty-col">Журнал пока пуст</div>'}</div>`;
  }

  window.renderCabinet=function(){
    const root=document.getElementById('cabinet-content');
    if(!root)return;
    const list=visibleForStats();
    if(isBoss()){
      root.innerHTML=`<div class="card atom-hero-card">
        <div class="card-title">Boss кабинет</div>
        <div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'B')[0])}</div><div><div class="md-title">${esc(profile?.name||'Boss')}</div><div class="archive-meta">${esc(profile?.role||'Boss / owner')} · login: ${esc(profile?.login||'boss')}</div></div></div>
      </div>
      ${detailsClean('Клиенты в CRM', clientsTableHtml(list), {open:false})}
      ${detailsClean('Учетки менеджеров', bossUsersClean(), {open:false})}
      ${detailsClean('Telegram Boss', telegramSettingsCard('boss'), {hint:(atomTelegramSettings.find(s=>s.managerLogin==='boss')?.telegramSessionStatus==='configured'?'Подключен':'Не подключен'), open:false})}
      ${detailsClean('Журнал действий', auditClean(), {open:false})}`;
    }else{
      root.innerHTML=`<div class="card atom-hero-card">
        <div class="card-title">Личный кабинет</div>
        <div class="cab-person"><div class="cab-avatar">${esc((profile?.name||'М')[0])}</div><div><div class="md-title">${esc(profile?.name||'Менеджер')}</div><div class="archive-meta">${esc(profile?.role||'CRM / менеджер')} · ${esc(profile?.city||'')} · login: ${esc(profile?.login||'')}</div></div></div>
      </div>
      ${detailsClean('Telegram подключение', telegramSettingsCard(profile?.login), {hint:(atomTelegramSettings.find(s=>s.managerLogin===profile?.login)?.telegramSessionStatus==='configured'?'Подключен':'Не подключен'), open:true})}
      ${detailsClean('Мои клиенты', clientsTableHtml(list), {open:false})}
      ${detailsClean('Журнал действий', auditClean(), {open:false})}`;
    }
  };

  const showPageBeforeCleanStats=window.showPage||showPage;
  window.showPage=function(id,el){
    if(id==='managers')id='stats';
    showPageBeforeCleanStats(id,el);
    ensureCleanTabs();
    if(id==='stats')window.renderStatsPage();
    if(id==='cabinet')window.renderCabinet();
  };
  try{showPage=window.showPage}catch(_){}

  window.ensureBossWorkTabs=function(){
    ensureCleanTabs();
  };

  document.addEventListener('DOMContentLoaded',()=>setTimeout(ensureCleanTabs,700));
})();

(function(){
  let unifiedInboxChats=[];
  let unifiedSelectedId='';
  let unifiedChatMode='active';

  const unifiedStyle=document.createElement('style');
  unifiedStyle.textContent=`
    .atom-chat-tabs{display:flex;gap:8px;margin:10px 0 12px}
    .atom-chat-tab{border:1px solid var(--border);background:rgba(255,255,255,.025);color:var(--muted);border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer}
    .atom-chat-tab.active{border-color:var(--blue);background:rgba(91,138,255,.12);color:var(--text)}
    .atom-source-chip{display:inline-flex;align-items:center;width:max-content;border:1px solid rgba(91,138,255,.32);background:rgba(91,138,255,.10);color:var(--blue);border-radius:999px;padding:2px 7px;font-size:9px;margin-top:6px}
    .atom-source-chip.crm{border-color:rgba(34,197,94,.30);background:rgba(34,197,94,.09);color:var(--green)}
    .atom-source-chip.archive{border-color:rgba(148,163,184,.28);background:rgba(148,163,184,.08);color:var(--muted)}
    .atom-chat-panel-empty{min-height:calc(100vh - 116px);display:flex;align-items:center;justify-content:center;color:var(--muted)}
    .atom-audit-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .atom-audit-chip{border:1px solid var(--border);border-radius:999px;padding:6px 10px;font-size:11px;color:var(--muted);background:rgba(255,255,255,.025)}
    .atom-audit-timeline{display:flex;flex-direction:column;gap:10px;max-height:520px;overflow:auto;padding-right:4px}
    .atom-audit-day{position:sticky;top:0;z-index:1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--blue);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .atom-audit-event{display:grid;grid-template-columns:88px 1fr;gap:12px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.02);padding:10px 12px}
    .atom-audit-time{font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:11px}
    .atom-audit-title{font-weight:800;color:var(--text);font-size:13px}
    .atom-audit-meta{color:var(--muted);font-size:10px;margin-top:4px}
    .atom-audit-details{color:var(--dim);font-size:11px;margin-top:6px;line-height:1.4}
    @media(max-width:820px){.atom-audit-event{grid-template-columns:1fr}.atom-chat-tabs{overflow:auto}.atom-chat-tab{white-space:nowrap}}
  `;
  document.head.appendChild(unifiedStyle);

  function shortCleanDate(value){
    if(!value)return '';
    return String(value).replace('T',' ').replace('Z','').slice(0,16);
  }

  function dayLabel(value){
    const s=shortCleanDate(value);
    if(!s)return 'Без даты';
    const [date]=s.split(' ');
    const [y,m,d]=date.split('-');
    return [d,m,y].filter(Boolean).join('.');
  }

  function timeLabel(value){
    return shortCleanDate(value).split(' ')[1]||'';
  }

  function inboxTitleClean(chat){
    return chat?.title || chat?.username || chat?.phone || 'Telegram чат';
  }

  function inboxLastMessageClean(chat){
    const messages=Array.isArray(chat?.messages)?chat.messages:[];
    return messages.at(-1)||null;
  }

  function crmLastMessageClean(client){
    const messages=Array.isArray(client?.telegramMessages)?client.telegramMessages:[];
    return messages.at(-1)||null;
  }

  function hasRealCrmChat(client){
    const username=window.chatUsername?.(client) || client?.username || client?.telegramChat?.username || '';
    const chat=client?.telegramChat||{};
    return !!(username || chat.chatId || (Array.isArray(client?.telegramMessages)&&client.telegramMessages.length));
  }

  function crmChatItems(){
    return (typeof visibleClients==='function'?visibleClients():(clients||[]))
      .filter(hasRealCrmChat)
      .map(client=>{
        const last=crmLastMessageClean(client);
        const username=window.chatUsername?.(client) || client.username || '';
        return {
          kind:'crm',
          id:'crm:'+client.id,
          clientId:client.id,
          title:client.name || client.telegramChat?.title || 'Клиент',
          username,
          phone:client.phone||'',
          city:client.city||'',
          category:client.category||'',
          archived:!!client.chatArchived,
          lastAt:last?.date||client.telegramChat?.lastMessageAt||client.updatedAt||client.createdAt||'',
          lastText:last?.text||client.telegramChat?.lastMessageText||'История еще не загружена',
          sourceLabel:'Создан в CRM',
          sourceClass:'crm',
          client,
        };
      });
  }

  function inboxChatItems(){
    return unifiedInboxChats.map(chat=>{
      const last=inboxLastMessageClean(chat);
      return {
        kind:'inbox',
        id:'inbox:'+chat.id,
        inboxId:chat.id,
        title:inboxTitleClean(chat),
        username:chat.username||'',
        phone:chat.phone||'',
        city:chat.city||'',
        category:chat.category||'',
        archived:String(chat.status||'new')==='archived',
        lastAt:last?.date||chat.lastMessageAt||chat.updatedAt||chat.createdAt||'',
        lastText:last?.text||chat.lastMessageText||'История еще не загружена',
        sourceLabel:'Импортирован из Telegram',
        sourceClass:'tg',
        chat,
      };
    });
  }

  function allUnifiedChatItems(){
    return [...crmChatItems(),...inboxChatItems()].sort((a,b)=>String(b.lastAt||'').localeCompare(String(a.lastAt||'')));
  }

  function filteredUnifiedItems(){
    const q=String(document.getElementById('unified-chat-search')?.value||'').trim().toLowerCase();
    return allUnifiedChatItems()
      .filter(item=>unifiedChatMode==='archive'?item.archived:!item.archived)
      .filter(item=>!q || [item.title,item.username,item.phone,item.city,item.category,item.lastText,item.sourceLabel].join(' ').toLowerCase().includes(q));
  }

  function setUnifiedChatsBadge(){
    const badge=document.getElementById('chats-badge');
    if(!badge)return;
    localStorage.setItem('atom_v7_unread_chats','{}');
    badge.style.display='none';
    badge.textContent='';
  }

  async function loadUnifiedInbox(){
    try{
      const data=await backendRequest('/api/telegram-inbox');
      unifiedInboxChats=Array.isArray(data.chats)?data.chats:[];
    }catch(e){
      unifiedInboxChats=[];
      console.warn('Inbox load skipped:',e.message);
    }
    setUnifiedChatsBadge();
    return unifiedInboxChats;
  }

  function unifiedRowsHtml(items){
    if(!items.length){
      return `<div class="empty-col">${unifiedChatMode==='archive'?'Архив чатов пока пуст.':'Активных чатов пока нет. Импортируйте Telegram-чаты или создайте клиента с username.'}</div>`;
    }
    return items.map(item=>{
      const active=item.id===unifiedSelectedId;
      return `<div class="atom-chat-row ${active?'active':''}" data-onclick="selectUnifiedChat('${esc(item.id)}')">
        <div class="atom-chat-row-top">
          <div class="atom-chat-row-name">${esc(item.title)}</div>
          <div class="atom-chat-row-time">${esc(shortCleanDate(item.lastAt))}</div>
        </div>
        <div class="atom-chat-row-meta">${esc(item.username||'username не указан')} · ${esc(item.phone||'телефон не указан')}</div>
        <span class="atom-source-chip ${item.sourceClass}">${esc(item.sourceLabel)}</span>
        <div class="atom-chat-row-last">${esc(item.lastText||'История еще не загружена')}</div>
      </div>`;
    }).join('');
  }

  function inboxMessagesCleanHtml(chat){
    const fake={telegramMessages:Array.isArray(chat?.messages)?chat.messages:[]};
    if(typeof window.chatMessagesHtml==='function')return window.chatMessagesHtml(fake,true);
    const messages=fake.telegramMessages.slice(-140);
    if(!messages.length)return '<div class="empty-col">История пока пустая.</div>';
    return messages.map(message=>`<div class="atom-chat-bubble ${String(message.sender)==='manager'?'manager':'client'}"><div class="atom-chat-meta">${String(message.sender)==='manager'?'Менеджер':'Клиент'} · ${esc(shortCleanDate(message.date))}</div>${esc(message.text||'')}</div>`).join('');
  }

  function unifiedPanelHtml(item){
    if(!item)return `<div class="atom-chat-panel-empty">Выберите чат слева.</div>`;
    const username=String(item.username||'').replace('@','');
    const archiveButton=item.archived
      ? `<button class="btn btn-b btn-xs" data-onclick="setUnifiedChatArchive('${esc(item.id)}',false,this)">Вернуть из архива</button>`
      : `<button class="btn btn-r btn-xs" data-onclick="setUnifiedChatArchive('${esc(item.id)}',true,this)">В архив</button>`;
    if(item.kind==='crm'){
      const c=item.client;
      return `<div class="atom-chat-head">
        <div><div class="atom-chat-title">${esc(item.title)}</div><div class="atom-chat-sub">${esc(item.city||'')} · ${esc(item.phone||'')} · ${esc(item.username||'username не указан')}</div><span class="atom-source-chip crm">Создан в CRM</span></div>
        <div class="quick-actions" style="margin-top:0">${username?`<button class="btn btn-b btn-xs" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}<button class="btn btn-xs" data-onclick="openClient('${esc(c.id)}')">Карточка</button>${archiveButton}</div>
      </div>
      <div class="atom-chat-history large" id="unified-chat-history">${typeof window.chatMessagesHtml==='function'?window.chatMessagesHtml(c,true):''}</div>
      <div class="atom-chat-composer">
        <textarea class="fi" id="unified-chat-draft" placeholder="Напишите сообщение. Enter - отправить, Shift+Enter - новая строка"></textarea>
        <div class="quick-actions">
          <button class="btn btn-g" data-onclick="sendUnifiedCrmMessage('${esc(c.id)}',this)">Отправить в Telegram</button>
          <button class="btn btn-b" data-onclick="refreshUnifiedCrmHistory('${esc(c.id)}',this)">Обновить историю</button>
        </div>
      </div>`;
    }
    const chat=item.chat;
    return `<div class="atom-chat-head">
      <div><div class="atom-chat-title">${esc(item.title)}</div><div class="atom-chat-sub">${esc(item.username||'username не указан')} · ${esc(item.phone||'телефон не указан')}</div><span class="atom-source-chip">Импортирован из Telegram</span></div>
      <div class="quick-actions" style="margin-top:0">${username?`<button class="btn btn-b btn-xs" data-onclick="window.open('https://t.me/${esc(username)}','_blank')">Открыть Telegram</button>`:''}${archiveButton}<button class="btn btn-r btn-xs" data-onclick="deleteUnifiedInboxChat('${esc(chat.id)}',this)">Удалить</button></div>
    </div>
    <div class="atom-chat-history large" id="unified-chat-history">${inboxMessagesCleanHtml(chat)}</div>
    <div class="card atom-inbox-convert">
      <div class="card-title">Оформить как клиента CRM</div>
      <div class="fg3">
        <div><div class="fl">Имя клиента</div><input class="fi" id="unified-client-name" value="${esc(item.title)}"></div>
        <div><div class="fl">Сумма ₽</div><input class="fi" id="unified-client-amount" type="number" placeholder="500000"></div>
        <div><div class="fl">Город</div><select class="fs" id="unified-client-city"><option>Уфа</option><option>Казань</option><option>Екатеринбург</option><option>Москва</option></select></div>
      </div>
      <div class="fg3" style="margin-top:10px">
        <div><div class="fl">Категория</div><select class="fs" id="unified-client-category"><option>Криптообмен</option><option>Автомобили</option><option>Недвижимость</option><option>Цветы</option><option>Табак / уголь</option><option>Китай / импорт</option></select></div>
        <div><div class="fl">Направление</div><select class="fs" id="unified-client-dir"><option value="buy">Рубли → USDT</option><option value="sell">USDT → Рубли</option></select></div>
        <div><div class="fl">Ответственный</div><select class="fs" id="unified-client-owner">${typeof managerSelectOptions==='function'?managerSelectOptions(profile?.login||'atom'):''}</select></div>
      </div>
      <div class="quick-actions"><button class="btn btn-g" data-onclick="createClientFromUnifiedInbox('${esc(chat.id)}',this)">Создать клиента</button></div>
    </div>`;
  }

  function scrollUnifiedHistory(){
    setTimeout(()=>{
      const box=document.getElementById('unified-chat-history');
      if(box)box.scrollTop=box.scrollHeight;
    },0);
  }

  async function renderUnifiedChatsPage(){
    const root=document.getElementById('chats-content');
    if(!root)return;
    root.innerHTML=`<div class="card"><div class="card-title">Чаты</div><div class="empty-col">Загружаю чаты...</div></div>`;
    await loadUnifiedInbox();
    const items=filteredUnifiedItems();
    if(!unifiedSelectedId || !items.some(item=>item.id===unifiedSelectedId)){
      unifiedSelectedId=items[0]?.id||'';
    }
    const selected=allUnifiedChatItems().find(item=>item.id===unifiedSelectedId) || items[0];
    root.innerHTML=`<div class="atom-chat-page atom-unified-chat-page">
      <div class="card atom-chat-list-card">
        <div class="card-title">Чаты</div>
        <div class="atom-chat-muted">Единый список: клиенты CRM и личные Telegram-диалоги. Источник указан на каждой строке.</div>
        <div class="atom-chat-tabs">
          <button class="atom-chat-tab ${unifiedChatMode==='active'?'active':''}" data-onclick="setUnifiedChatMode('active')">Активные</button>
          <button class="atom-chat-tab ${unifiedChatMode==='archive'?'active':''}" data-onclick="setUnifiedChatMode('archive')">Архив чатов</button>
        </div>
        <div class="quick-actions"><button class="btn btn-g" data-onclick="importUnifiedPrivateChats(this)">Импортировать личные чаты</button></div>
        <input class="fi atom-chat-search" id="unified-chat-search" placeholder="Поиск: имя, username, телефон, текст" data-oninput="renderUnifiedChatRowsOnly()">
        <div class="atom-chat-list" id="unified-chat-list">${unifiedRowsHtml(items)}</div>
      </div>
      <div class="card atom-chat-panel-card" id="unified-chat-panel">${unifiedPanelHtml(selected)}</div>
    </div>`;
    setUnifiedChatsBadge();
    scrollUnifiedHistory();
  }

  window.setUnifiedChatMode=function(mode){
    unifiedChatMode=mode==='archive'?'archive':'active';
    unifiedSelectedId='';
    renderUnifiedChatsPage();
  };

  window.renderUnifiedChatRowsOnly=function(){
    const list=document.getElementById('unified-chat-list');
    if(list)list.innerHTML=unifiedRowsHtml(filteredUnifiedItems());
  };

  window.selectUnifiedChat=function(id){
    unifiedSelectedId=String(id);
    const items=filteredUnifiedItems();
    const selected=allUnifiedChatItems().find(item=>item.id===unifiedSelectedId);
    const list=document.getElementById('unified-chat-list');
    const panel=document.getElementById('unified-chat-panel');
    if(list)list.innerHTML=unifiedRowsHtml(items);
    if(panel)panel.innerHTML=unifiedPanelHtml(selected);
    scrollUnifiedHistory();
    setUnifiedChatsBadge();
  };

  window.setUnifiedChatArchive=async function(id, archived, btn){
    const item=allUnifiedChatItems().find(row=>row.id===id);
    if(!item)return;
    const old=btn?.textContent;
    if(btn){btn.textContent='Сохраняю...';btn.disabled=true}
    try{
      if(item.kind==='crm'){
        item.client.chatArchived=!!archived;
        save();
        await syncClientsToBackendNow();
      }else{
        const data=await backendRequest('/api/telegram-inbox/'+encodeURIComponent(item.inboxId)+'/status',{
          method:'PATCH',
          body:JSON.stringify({status:archived?'archived':'active'})
        });
        const idx=unifiedInboxChats.findIndex(chat=>String(chat.id)===String(item.inboxId));
        if(idx!==-1&&data.chat)unifiedInboxChats[idx]=data.chat;
      }
      atomToast?.(archived?'Чат отправлен в архив':'Чат возвращен из архива');
      unifiedSelectedId='';
      await renderUnifiedChatsPage();
      renderCRM();
    }catch(e){
      atomToast?.('Не удалось изменить архив чата: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.deleteUnifiedInboxChat=async function(id,btn){
    if(!confirm('Удалить импортированный чат из CRM? В Telegram он не удалится.'))return;
    const old=btn?.textContent;
    if(btn){btn.textContent='Удаляю...';btn.disabled=true}
    try{
      await backendRequest('/api/telegram-inbox/'+encodeURIComponent(id),{method:'DELETE'});
      unifiedInboxChats=unifiedInboxChats.filter(chat=>String(chat.id)!==String(id));
      unifiedSelectedId='';
      await renderUnifiedChatsPage();
      atomToast?.('Чат удален из CRM');
    }catch(e){
      atomToast?.('Не удалось удалить чат: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.importUnifiedPrivateChats=async function(btn){
    const old=btn?.textContent;
    if(btn){btn.textContent='Импортирую...';btn.disabled=true}
    try{
      const data=await backendRequest('/api/telegram-inbox/import-private',{
        method:'POST',
        body:JSON.stringify({dialogsLimit:150,historyLimit:40})
      });
      atomToast?.(`Импортировано личных чатов: ${data.chatsCount||0}`);
      unifiedSelectedId='';
      unifiedChatMode='active';
      await renderUnifiedChatsPage();
    }catch(e){
      atomToast?.('Не удалось импортировать чаты: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.createClientFromUnifiedInbox=async function(id,btn){
    const chat=unifiedInboxChats.find(item=>String(item.id)===String(id));
    if(!chat)return;
    const amount=Number(document.getElementById('unified-client-amount')?.value||0);
    const client=normalizeClient({
      id:gid(),
      name:document.getElementById('unified-client-name')?.value.trim()||inboxTitleClean(chat),
      phone:chat.phone||'',
      username:chat.username||'',
      city:document.getElementById('unified-client-city')?.value||'Уфа',
      category:document.getElementById('unified-client-category')?.value||'Криптообмен',
      source:'Telegram',
      amount,
      direction:document.getElementById('unified-client-dir')?.value||'buy',
      stage:'active',
      assignedTo:document.getElementById('unified-client-owner')?.value||profile?.login||'atom',
      createdAt:new Date().toISOString(),
      nextTouchDate:nextTouchDate(DEFAULT_TOUCH_DAYS),
      touchFrequency:DEFAULT_TOUCH_DAYS,
      telegramChat:{chatId:chat.chatId,title:chat.title||inboxTitleClean(chat),username:chat.username||'',status:'linked',lastMessageAt:chat.lastMessageAt,lastMessageText:chat.lastMessageText},
      telegramMessages:(chat.messages||[]),
      comment:'Создано из импортированного Telegram-чата',
      deals:[{id:gid(),createdAt:new Date().toISOString(),amount,stage:'active',sop:Array(DEAL_SOP_STEPS.length).fill(false)}],
      calcData:{rate:82,spread:.2,amount,fee:amount<250000},
    });
    const old=btn?.textContent;
    if(btn){btn.textContent='Создаю...';btn.disabled=true}
    try{
      clients.unshift(client);
      save();
      await syncClientsToBackendNow();
      await backendRequest('/api/telegram-inbox/'+encodeURIComponent(id)+'/status',{method:'PATCH',body:JSON.stringify({status:'archived'})});
      atomToast?.('Клиент создан, исходный импорт отправлен в архив');
      renderCRM();
      unifiedSelectedId='crm:'+client.id;
      unifiedChatMode='active';
      await renderUnifiedChatsPage();
    }catch(e){
      atomToast?.('Не удалось создать клиента: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.sendUnifiedCrmMessage=async function(id,btn){
    const c=(clients||[]).find(item=>String(item.id)===String(id));
    const input=document.getElementById('unified-chat-draft');
    const text=String(input?.value||'').trim();
    if(!c||!text){atomToast?.('Введите сообщение');return}
    const old=btn?.textContent;
    if(btn){btn.textContent='Отправляю...';btn.disabled=true}
    try{
      await syncClientsToBackendNow();
      const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/send-telegram',{
        method:'POST',
        body:JSON.stringify({client:clientPayload(c),text})
      });
      Object.assign(c,normalizeClient({...c,...data.client}));
      save();
      if(input)input.value='';
      await renderUnifiedChatsPage();
      renderCRM();
      atomToast?.('Сообщение отправлено в Telegram');
    }catch(e){
      atomToast?.('Не удалось отправить в Telegram: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  window.refreshUnifiedCrmHistory=async function(id,btn){
    const c=(clients||[]).find(item=>String(item.id)===String(id));
    if(!c)return;
    const draft=document.getElementById('unified-chat-draft')?.value||'';
    const old=btn?.textContent;
    if(btn){btn.textContent='Обновляю...';btn.disabled=true}
    try{
      await syncClientsToBackendNow();
      const data=await backendRequest('/api/clients/'+encodeURIComponent(c.id)+'/link-telegram',{
        method:'POST',
        body:JSON.stringify({client:clientPayload(c),historyLimit:100})
      });
      Object.assign(c,normalizeClient({...c,...data.client}));
      save();
      await renderUnifiedChatsPage();
      const after=document.getElementById('unified-chat-draft');
      if(after)after.value=draft;
      atomToast?.('История Telegram обновлена');
    }catch(e){
      atomToast?.('Не удалось обновить историю: '+e.message,'err');
    }finally{
      if(btn){btn.textContent=old;btn.disabled=false}
    }
  };

  function cleanAuditRowsBetter(){
    const raw=(typeof atomAuditLogs!=='undefined'&&Array.isArray(atomAuditLogs)&&atomAuditLogs.length)
      ? atomAuditLogs
      : (typeof bossLogRows==='function'?bossLogRows():[]);
    const blocked=['Синхронизировал клиентов','Импортировал Telegram-историю'];
    const seen=new Set();
    return raw
      .filter(row=>!blocked.some(text=>String(row.action||'').includes(text)))
      .filter(row=>{
        const key=[row.action,row.managerLogin||row.manager,row.clientName,row.details,String(row.createdAt||row.date||'').slice(0,16)].join('|');
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      })
      .slice(0,120);
  }

  function auditLabel(action){
    const value=String(action||'Действие');
    if(value.includes('Telegram'))return 'Telegram';
    if(value.includes('пароль')||value.includes('учет'))return 'Учетки';
    if(value.includes('архив'))return 'Архив';
    if(value.includes('клиент')||value.includes('сдел'))return 'Клиенты';
    return 'CRM';
  }

  function betterAuditHtml(){
    const rows=cleanAuditRowsBetter();
    if(!rows.length)return '<div class="empty-col">Журнал пока пуст.</div>';
    let lastDay='';
    return `<div class="atom-audit-toolbar">
      <span class="atom-audit-chip">Последние действия: ${rows.length}</span>
      <span class="atom-audit-chip">Служебная синхронизация скрыта</span>
    </div>
    <div class="atom-audit-timeline">${rows.map(row=>{
      const date=row.createdAt||row.date||'';
      const day=dayLabel(date);
      const dayHtml=day!==lastDay?`<div class="atom-audit-day">${esc(day)}</div>`:'';
      lastDay=day;
      return `${dayHtml}<div class="atom-audit-event">
        <div class="atom-audit-time">${esc(timeLabel(date))}</div>
        <div>
          <div class="atom-audit-title">${esc(row.action||'Действие')} <span class="atom-source-chip archive">${esc(auditLabel(row.action))}</span></div>
          <div class="atom-audit-meta">${esc(managerName(row.managerLogin||row.manager))}${row.clientName?' · '+esc(row.clientName):''}</div>
          ${row.details?`<div class="atom-audit-details">${esc(row.details)}</div>`:''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function improveAuditDetails(){
    const root=document.getElementById('cabinet-content');
    if(!root)return;
    const details=[...root.querySelectorAll('details.atom-details')].find(item=>{
      const summary=item.querySelector('summary span');
      return (summary?.textContent||'').includes('Журнал действий');
    });
    const body=details?.querySelector('.atom-details-body');
    if(body)body.innerHTML=betterAuditHtml();
  }

  const previousRenderCabinetUnified=window.renderCabinet||renderCabinet;
  window.renderCabinet=function(){
    previousRenderCabinetUnified();
    improveAuditDetails();
  };
  try{renderCabinet=window.renderCabinet}catch(_){}

  const previousRenderCrmUnified=window.renderCRM||renderCRM;
  window.renderCRM=function(){
    previousRenderCrmUnified();
    setUnifiedChatsBadge();
  };
  try{renderCRM=window.renderCRM}catch(_){}

  const previousShowPageUnified=window.showPage||showPage;
  window.showPage=function(id,el){
    if(id==='chats'){
      document.querySelectorAll('.page').forEach(page=>page.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(item=>item.classList.remove('active'));
      document.getElementById('page-chats')?.classList.add('active');
      (el||document.getElementById('sb-chats-link'))?.classList.add('active');
      const title=document.getElementById('topbar-title');
      if(title)title.textContent='Чаты';
      renderUnifiedChatsPage();
      return;
    }
    previousShowPageUnified(id,el);
    if(id==='cabinet')improveAuditDetails();
    setUnifiedChatsBadge();
  };
  try{showPage=window.showPage}catch(_){}

  document.addEventListener('keydown',(event)=>{
    if(event.isComposing||event.key!=='Enter'||event.shiftKey)return;
    if(!(event.target instanceof HTMLTextAreaElement))return;
    if(event.target.id==='unified-chat-draft'&&unifiedSelectedId.startsWith('crm:')){
      event.preventDefault();
      const clientId=unifiedSelectedId.slice(4);
      const btn=document.querySelector('#unified-chat-panel .btn.btn-g');
      sendUnifiedCrmMessage(clientId,btn);
    }
  });

  document.addEventListener('DOMContentLoaded',()=>setTimeout(setUnifiedChatsBadge,800));
window.renderTelegramInboxPage=renderUnifiedChatsPage;
window.atomRefreshUnifiedChatsBadge=setUnifiedChatsBadge;
})();

(() => {
  function removeDuplicateManagerSelect(){
    const duplicate=document.getElementById('mi-assigned-to');
    if(!duplicate)return;
    const wrapper=duplicate.closest('div[style*="margin-top"]')||duplicate.parentElement;
    wrapper?.remove();
  }

  function ensureDeleteClientButton(){
    const actions=document.querySelector('#client-modal .md-head > div:last-child');
    if(!actions || document.getElementById('delete-client-btn'))return;
    const close=actions.querySelector('.md-close');
    const btn=document.createElement('button');
    btn.className='btn btn-r btn-xs';
    btn.id='delete-client-btn';
    btn.type='button';
    btn.textContent='Удалить клиента';
    btn.onclick=()=>window.deleteActiveClient?.();
    if(close)actions.insertBefore(btn,close);
    else actions.appendChild(btn);
  }

  function fixBossAssignSelect(){
    const client=(clients||[]).find(item=>String(item.id)===String(activeClientId||''));
    const select=document.getElementById('boss-assign-select');
    if(!client||!select)return;
    const login=String(client.assignedTo||'');
    if(login&&![...select.options].some(option=>String(option.value)===login)){
      const option=document.createElement('option');
      option.value=login;
      option.textContent=(typeof managerName==='function'?managerName(login):login)+' ('+login+')';
      select.appendChild(option);
    }
    select.value=login;
  }

  window.deleteActiveClient=async function(){
    const id=String(activeClientId||'');
    const client=(clients||[]).find(item=>String(item.id)===id);
    if(!client)return;
    if(!confirm(`Удалить клиента "${client.name}" из CRM? Это действие нельзя отменить.`))return;
    try{
      await backendRequest('/api/clients/'+encodeURIComponent(id),{method:'DELETE'});
      clients=(clients||[]).filter(item=>String(item.id)!==id);
      save();
      document.getElementById('client-modal')?.classList.remove('open');
      activeClientId=null;
      renderCRM();
      renderArchive();
      renderCabinet();
      if(typeof renderUnifiedChatsPage==='function'&&document.getElementById('page-chats')?.classList.contains('active')){
        renderUnifiedChatsPage();
      }
      atomToast?.('Клиент удален из CRM');
    }catch(e){
      atomToast?.('Не удалось удалить клиента: '+e.message,'err');
    }
  };

  const previousLoadInfoDeletePatch=window.loadInfo||loadInfo;
  window.loadInfo=function(c){
    previousLoadInfoDeletePatch(c);
    removeDuplicateManagerSelect();
    fixBossAssignSelect();
  };
  try{loadInfo=window.loadInfo}catch(_){}

  const previousSwitchTabDeletePatch=window.switchTab||switchTab;
  window.switchTab=function(id,el){
    previousSwitchTabDeletePatch(id,el);
    if(id==='info')removeDuplicateManagerSelect();
    fixBossAssignSelect();
  };
  try{switchTab=window.switchTab}catch(_){}

  const previousOpenClientDeletePatch=window.openClient||openClient;
  window.openClient=function(id){
    previousOpenClientDeletePatch(id);
    ensureDeleteClientButton();
    removeDuplicateManagerSelect();
    fixBossAssignSelect();
  };
  try{openClient=window.openClient}catch(_){}
})();
