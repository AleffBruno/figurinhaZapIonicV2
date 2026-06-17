
/*

Adiciona/remove "X" dias a mais na data

01/01/2020 vai para 02/01/2020

*/

export function addOrRemoveDaysFromDate(date : Date, action: 'add' | 'remove', days) : string {

     // Faz uma cópia da data original, isso deve-se porque "date" é como se fosse static, ou seja, iria alterar o objeto original
    const newDate = new Date(date.getTime());

    if(action == 'add') {
        return new Date(newDate.setDate(newDate.getDate() + (days))).toISOString();
    } else {
        return new Date(newDate.setDate(newDate.getDate() - (days))).toISOString();
    }

}
  