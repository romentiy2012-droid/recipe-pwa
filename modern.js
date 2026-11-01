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
 if(button)button.addEventListener('click',()=>{
   theme=document.body.classList.contains('modern-ui')?'classic':'modern';
   try{localStorage.setItem(key,theme)}catch{}
   apply(theme);
 });
})();
