(()=>{
 'use strict';

 const form=document.querySelector('[data-tour-order-form]');
 if(form){
  const list=form.querySelector('[data-tour-order-list]');
  const orderInput=form.querySelector('[data-scene-order]');
  const saveButton=form.querySelector('[data-order-save]');
  const status=form.querySelector('[data-order-status]');
  const original=orderInput.value;
  let dragged=null;
  let submitting=false;
  const items=()=>Array.from(list.querySelectorAll('[data-scene-id]'));

  function sync(){
   const rows=items();
   orderInput.value=JSON.stringify(rows.map(row=>Number(row.dataset.sceneId)));
   rows.forEach((row,index)=>{
    row.querySelector('[data-scene-number]').textContent=String(index+1).padStart(2,'0');
    row.querySelector('[data-order-up]').disabled=index===0;
    row.querySelector('[data-order-down]').disabled=index===rows.length-1;
   });
   const changed=orderInput.value!==original;
   saveButton.disabled=!changed;
   status.textContent=changed?'Порядок изменён. Нажмите «Сохранить порядок».':new URLSearchParams(location.search).has('reordered')?'Порядок сцен сохранён.':'Порядок сцен актуален.';
  }

  list.addEventListener('click',event=>{
   const button=event.target.closest('[data-order-up],[data-order-down]');
   if(!button)return;
   const row=button.closest('[data-scene-id]');
   if(button.matches('[data-order-up]')&&row.previousElementSibling){
    list.insertBefore(row,row.previousElementSibling);
   }else if(button.matches('[data-order-down]')&&row.nextElementSibling){
    list.insertBefore(row.nextElementSibling,row);
   }
   sync();
   button.focus();
  });

  list.addEventListener('dragstart',event=>{
   const row=event.target.closest('[data-scene-id]');
   if(!row||!event.dataTransfer)return;
   dragged=row;
   event.dataTransfer.effectAllowed='move';
   event.dataTransfer.setData('text/plain',row.dataset.sceneId);
   row.classList.add('is-dragging');
  });
  list.addEventListener('dragover',event=>{
   if(!dragged)return;
   const target=event.target.closest('[data-scene-id]');
   if(!target||target===dragged)return;
   event.preventDefault();
   event.dataTransfer.dropEffect='move';
   const after=event.clientY>target.getBoundingClientRect().top+target.offsetHeight/2;
   list.insertBefore(dragged,after?target.nextSibling:target);
   sync();
  });
  list.addEventListener('drop',event=>{if(dragged)event.preventDefault()});
  list.addEventListener('dragend',()=>{
   dragged?.classList.remove('is-dragging');dragged=null;sync();
  });
  form.addEventListener('submit',()=>{submitting=true});
  window.addEventListener('beforeunload',event=>{
   if(!submitting&&orderInput.value!==original){event.preventDefault();event.returnValue='';}
  });
  list.querySelectorAll('[data-edit-scene]').forEach(link=>{
   link.addEventListener('click',()=>{
    const editor=document.getElementById(link.hash.slice(1));
    if(!editor)return;
    document.querySelectorAll('.scene-card.is-selected').forEach(row=>row.classList.remove('is-selected'));
    editor.classList.add('is-selected');
   });
  });
  sync();
 }

 const picker=document.querySelector('[data-pano-picker]');
 const select=document.querySelector('[data-pano-select]');
 if(picker&&select){
  const cards=Array.from(picker.querySelectorAll('[data-pano-id]'));
  const search=document.querySelector('[data-pano-search]');
  const syncSelection=()=>cards.forEach(card=>{
   const selected=card.dataset.panoId===select.value;
   card.classList.toggle('is-selected',selected);
   card.setAttribute('aria-pressed',String(selected));
  });
  picker.addEventListener('click',event=>{
   const card=event.target.closest('[data-pano-id]');
   if(!card)return;
   select.value=card.dataset.panoId;
   syncSelection();
  });
  select.addEventListener('change',syncSelection);
  search?.addEventListener('input',()=>{
   const query=search.value.trim().toLocaleLowerCase();
   cards.forEach(card=>{card.hidden=!card.dataset.panoTitle.toLocaleLowerCase().includes(query)});
  });
  syncSelection();
 }
})();
