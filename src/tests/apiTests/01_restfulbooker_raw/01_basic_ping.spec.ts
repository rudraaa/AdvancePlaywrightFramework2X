import { expect,test } from "@playwright/test";
//import { request } from "node:http";
test("first basic api action",async({request})=>{
const responseData=await request.get("/ping");
console.log(responseData);
expect(responseData.status()).toBe(201); 
});