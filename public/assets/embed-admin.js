const copyButton=document.querySelector('#embed-copy');
copyButton?.addEventListener('click',async()=>{
 const field=document.querySelector('#embed-iframe-code');
 const status=document.querySelector('#embed-copy-status');
 if(!field)return;
 try{await navigator.clipboard.writeText(field.value);status.textContent='HTML скопирован';}
 catch(_){field.focus();field.select();status.textContent='Скопируйте выделенный код (Ctrl+C)';}
});
