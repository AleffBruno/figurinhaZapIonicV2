
/*

Adiciona "X" semanas a mais na data

01/01/2020 vai para 08/01/2020

*/

export function addWeeksToDate(date : Date, numberOfWeeksToAdd) : string {

  return new Date(date.setDate(date.getDate() + (numberOfWeeksToAdd * 7))).toISOString();
}
