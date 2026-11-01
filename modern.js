'use strict';
// Visual-only theme switch. Existing IndexedDB and app behavior are unchanged.
(() => {
 const key='recipe-ui-theme';
 const button=document.getElementById('themeToggle');
 const apply=(theme)=>{
   const modern=theme!=='classic';
   document.body.classList.toggle('modern-ui',modern);
   if(button){button.textContent=modern?'🖥️ Стиль Windows 98':'✨ Современный вид';button.setAttribute('aria-pressed',String(modern));}
   const color=document.querySelector('meta[name="theme-color"]');
   if(color)color.content=modern?'#f4f7f2':'#008080';
 };
 let theme='modern';
 try{theme=localStorage.getItem(key)||'modern'}catch{}
 apply(theme);
 // Mobile shortcuts invoke the existing, tested application controls.
 const nav=document.createElement('nav');
 nav.className='modern-bottom-nav';
 nav.setAttribute('aria-label','Навигация по рецептам');
 const entries=[
  ['📖','Рецепты',()=>document.getElementById('iconRecipes')?.click()],
  ['❤️','Избранное',()=>document.getElementById('iconFav')?.click()],
  ['➕','Добавить',()=>document.getElementById('addBtn')?.click()],
  ['📅','Меню',()=>document.querySelector('[data-extra-action="planner"]')?.click()],
  ['🛒','Покупки',()=>document.querySelector('[data-extra-action="shopping"]')?.click()]
 ];
 entries.forEach(([emoji,label,act],i)=>{
  const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);
  b.innerHTML='<span aria-hidden="true">'+emoji+'</span><small>'+label+'</small>';
  b.addEventListener('click',()=>{act();nav.querySelectorAll('button').forEach(x=>x.removeAttribute('data-active'));b.setAttribute('data-active','true')});
  if(i===0)b.setAttribute('data-active','true');
  nav.appendChild(b);
 });
 document.body.appendChild(nav);
 if(button)button.addEventListener('click',()=>{
   theme=document.body.classList.contains('modern-ui')?'classic':'modern';
   try{localStorage.setItem(key,theme)}catch{}
   apply(theme);
 });
})();
