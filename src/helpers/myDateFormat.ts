/*
Recebe um objeto new Date() e devolve uma string no formato yyyy-mm-dd

Motivo: 
*/

function adicionaZero(numero){
  if (numero <= 9) 
      return "0" + numero;
  else
      return numero; 
}

export function myDateFormat(date: Date) : string {
  return ( date.getFullYear() + "-" + (adicionaZero(date.getMonth()+1).toString()) + "-" + adicionaZero(date.getDate().toString()) );
}
  
  
  