/*
Recebe a string com o formato "yyyy-mm-dd", troca o simbolo ' - ' por ' / '

Motivo: "escrevo depois kkkkkkk"
*/

export function replaceDashToSlash(dateYyyyDashMmDashDd:string) : string {
    return dateYyyyDashMmDashDd.replace(/\-/g, "/")
}
  
  
  