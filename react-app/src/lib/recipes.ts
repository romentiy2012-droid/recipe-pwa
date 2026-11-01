export type Recipe={id?:number;uuid?:string;title:string;description?:string;category?:string;ingredients?:string;ingredientItems?:{name:string;amount:number|null;unit:string}[];steps?:string;servings?:number;favorite?:boolean;image?:Blob|string|null;createdAt?:number;updatedAt?:number;notes?:string;tags?:string[];sourceUrl?:string};
const NAME="recipeDB",VERSION=3,STORE="recipes";
export async function openRecipesDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(NAME,VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings",{keyPath:"key"});if(!db.objectStoreNames.contains("categories"))db.createObjectStore("categories",{keyPath:"name"});if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:"id",autoIncrement:true});s.createIndex("title","title",{unique:false})}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function tx<T>(db:IDBDatabase,mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,mode);const request=action(transaction.objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
export async function listRecipes(db:IDBDatabase):Promise<Recipe[]>{const all=await tx(db,"readonly",s=>s.getAll() as IDBRequest<Recipe[]>);return all.filter(r=>!((r as Recipe&{deletedAt?:number;trashedAt?:number}).deletedAt||(r as Recipe&{deletedAt?:number;trashedAt?:number}).trashedAt)) }
export function saveRecipe(db:IDBDatabase,recipe:Recipe){return tx(db,"readwrite",s=>s.put(recipe))}
export function addRecipe(db:IDBDatabase,recipe:Recipe){return tx(db,"readwrite",s=>s.add(recipe))}
export function getRecipe(db:IDBDatabase,id:number){return tx(db,"readonly",s=>s.get(id) as IDBRequest<Recipe>)}
export async function exportRecipes(db:IDBDatabase){const all=await tx(db,"readonly",s=>s.getAll() as IDBRequest<Recipe[]>);const sanitized=await Promise.all(all.map(async r=>({...r,image:r.image instanceof Blob?await blobToDataURL(r.image):r.image})));const blob=new Blob([JSON.stringify({version:4,recipes:sanitized,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="recipes-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
const blobToDataURL=(blob:Blob):Promise<string>=>new Promise((resolve,reject)=>{const r=new FileReader;r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob)});
export async function imageToSrc(image:Recipe["image"]){if(typeof image==="string")return image;if(image instanceof Blob)return URL.createObjectURL(image);return null}
export function ingredientLines(r:Recipe):string[]{if(Array.isArray(r.ingredientItems))return r.ingredientItems.filter(i=>i.name).map(i=>i.name+(i.amount!=null?" — "+i.amount:"")+(i.unit?" "+i.unit:""));return(r.ingredients||"").split("\n").map(s=>s.trim()).filter(Boolean)}

/** JSON backup import: additive only; skips UUID/id duplicates. */
export async function importRecipes(db:IDBDatabase,file:File):Promise<{added:number;skipped:number}>{
 if(file.size>75_000_000)throw new Error("Файл слишком большой (максимум 75 МБ)");
 const value:unknown=JSON.parse(await file.text());
 if(!value||typeof value!=="object")throw new Error("Некорректный JSON");
 const data=value as Record<string,unknown>;
 const arr=Array.isArray(data.recipes)?data.recipes:Array.isArray(value)?value:null;
 if(!arr)throw new Error("Не найден список рецептов");
 if(arr.length>10000)throw new Error("Слишком много рецептов в файле");
 const existing=await tx(db,"readonly",s=>s.getAll() as IDBRequest<Recipe[]>);
 const ids=new Set(existing.map(r=>r.uuid).filter(Boolean));
 let added=0,skipped=0;
 for(const raw of arr){
  if(!raw||typeof raw!=="object"){skipped++;continue}
  const r=raw as Record<string,unknown>;
  if(typeof r.title!=="string"||!r.title.trim()){skipped++;continue}
  const uuid=typeof r.uuid==="string"?r.uuid:undefined;
  if(uuid&&ids.has(uuid)){skipped++;continue}
  const image=typeof r.image==="string"&&r.image.startsWith("data:image/")?r.image:undefined;
  const record:Recipe={
   title:r.title.slice(0,200),description:typeof r.description==="string"?r.description:"",
   category:typeof r.category==="string"?r.category:"Другое",
   ingredients:typeof r.ingredients==="string"?r.ingredients:"",
   ingredientItems:Array.isArray(r.ingredientItems)?r.ingredientItems.filter((x:unknown)=>!!x&&typeof x==="object"&&typeof (x as {name?:unknown}).name==="string").slice(0,500) as Recipe["ingredientItems"]:undefined,
   steps:typeof r.steps==="string"?r.steps:"",
   servings:typeof r.servings==="number"&&r.servings>0?r.servings:1,
   image,uuid:uuid||crypto.randomUUID(),favorite:r.favorite===true,
   createdAt:typeof r.createdAt==="number"?r.createdAt:Date.now(),
   updatedAt:Date.now(),notes:typeof r.notes==="string"?r.notes:"",tags:Array.isArray(r.tags)?r.tags.filter((x:unknown)=>typeof x==="string") as string[]:[],
   sourceUrl:typeof r.sourceUrl==="string"?r.sourceUrl:""
  };
  await addRecipe(db,record);ids.add(record.uuid);added++;
 }
 return {added,skipped};
}
export function scaledIngredients(r:Recipe,servings:number):string[]{
 if(!r.ingredientItems?.length||!r.servings||r.servings<=0)return ingredientLines(r);
 return r.ingredientItems.filter(x=>x.name).map(x=>x.name+(x.amount!=null?" — "+Number((x.amount*servings/r.servings).toFixed(3)).toLocaleString("ru-RU"):"")+(x.unit?" "+x.unit:""));
}
