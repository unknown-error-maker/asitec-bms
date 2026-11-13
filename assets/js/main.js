(function(){
  var form=document.getElementById('quote-form');
  var status=document.getElementById('form-status');
  var firma=document.getElementById('firma-field');
  var msg=document.getElementById('mesaj');
  form.addEventListener('change',function(e){
    if(e.target.name!=='client')return;
    var pj=e.target.value==='pj';
    firma.hidden=!pj;
    msg.placeholder=pj?'De exemplu: firmă de distribuție, depozit în Timișoara, 8 mașini de livrare, polițele expiră în martie.':'De exemplu: RCA și CASCO pentru un autoturism din 2020, apartament în Timișoara.';
  });
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var nume=form.nume.value.trim(),tel=form.telefon.value.trim();
    status.hidden=false;
    if(!nume||!tel){
      status.textContent='Completează numele și telefonul, ca să te putem contacta.';
      (nume?form.telefon:form.nume).focus();
      return;
    }
    status.textContent='Formularul nu este încă legat de o adresă de e-mail. Până atunci, sună-ne la numărul de mai sus.';
  });
})();
