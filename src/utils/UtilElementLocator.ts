import {expect,Page,Locator} from "@playwright/test";
import {createLogger,type Logger} from "./logger";

export const DEFAULT_ACTION_TIMEOUT_MS= 15_000;
export type Flex=string|Locator;

export class UtilElementLocator
{
   private readonly page:Page;
   private readonly log:Logger;

   constructor(page:Page, scope: string='UtilElementLocator')
   {
    this.page=page;
    this.log=createLogger(scope);
   }

   private toLocator(target:Flex):Locator{
return typeof target==='string'?this.page.locator(target):target;
   }

   private describe(target:Flex):string{
    return typeof target==='string'?target:target.toString();
   }

    async click(target:Flex, timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>{

    const loc=this.toLocator(target);
    this.log.debug(`click ${this.describe(target)}`);
    await loc.click({timeout}); 
   }

   async doubleClick(target:Flex,timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
const loc=this.toLocator(target);
this.log.debug(`click ${this.describe(target)}`);
await loc.dblclick({timeout});
   }

   async rightClick(target:Flex, timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
const loc=this.toLocator(target);
this.log.debug(`click ${this.describe(target)}`);
await loc.click({button:'right',timeout});

   }

   async hover(target:Flex, timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
    const loc=this.toLocator(target);
    await loc.hover({timeout});
   }

   async fill(target:Flex,value:string,timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
    const loc=this.toLocator(target);
    this.log.debug(`fill ${this.describe(target)}`);
    await loc.fill(value,{timeout});
   }
   
   async typeText(target:Flex, value:string,timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
    const loc=this.toLocator(target);
    await loc.pressSequentially(value,{timeout});
   }
  
   async clear(target:Flex,timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
   {
   const loc= this.toLocator(target);
  await loc.clear({timeout});
   }

   async pressSequentially(
        target: Flex,
        value: string,
        timeout: number = DEFAULT_ACTION_TIMEOUT_MS,
    ): Promise<void> {
        const loc = this.toLocator(target);
        await loc.pressSequentially(value, { timeout });
    }

    // // ---------- text & content getters ----------

    async getText(target:Flex, timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<string>
    {
        const loc=this.toLocator(target);
       const txt= (await loc.textContent())??'';
       return txt.trim();
    }

    async getInnerText(target:Flex):Promise<string>
    {
       const loc= this.toLocator(target);
       return (await loc.innerText()).trim();
    }

    async getAllTexts(target:Flex):Promise<string[]>
    {
const loc=this.toLocator(target);
const texts=await loc.allTextContents();
return texts.map((t)=>t.trim());
    }

    async getAttr(target:Flex, name:string):Promise<string | null>
    {
       const loc= this.toLocator(target);
return loc.getAttribute(name);
    }

      async getValue(target: Flex): Promise<string> {
        const loc = this.toLocator(target);
        return loc.inputValue();
    }
    //count

    async count(target:Flex):Promise<number>
    {
        const loc=this.toLocator(target);
        return await loc.count();
    }

     // ---------- state checks ----------
     async isVisible(target:Flex):Promise<boolean>
     {
        const loc=this.toLocator(target);
        return await loc.isVisible();

     }

     async isEnabled(target: Flex): Promise<boolean> {
        const loc = this.toLocator(target);
        return await loc.isEnabled();
    }

     async isChecked(target: Flex): Promise<boolean> {
        const loc = this.toLocator(target);
        return await loc.isChecked();
    }

     // ---------- waits ----------

     async waitForVisible(target:Flex, timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
     {
        const loc=this.toLocator(target);
        await expect(loc).toBeVisible({timeout});
     }

     async waitForHidden(target:Flex,timeout:number=DEFAULT_ACTION_TIMEOUT_MS):Promise<void>
     {
         const loc=this.toLocator(target);
         await expect(loc).toBeHidden({timeout});

     }

      async waitForPageLoad(): Promise<void> {
        this.log.debug('waitForPageLoad');
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle').catch(() => {
            // TTACart is static + localStorage so networkidle is fast,
            // but we swallow the rare timeout so the test isn't punished
            // by background analytics calls on the demo origin.
        });
    }

        //-------------------selects--------------
         async selectByText(target:Flex, text:string):Promise<void>
        {
           const loc= this.toLocator(target);
           await loc.selectOption({label:text});
        }

         async selectByValue(target: Flex, value: string): Promise<void> {
        const loc = this.toLocator(target);
        await loc.selectOption({ value });
    }

    async selectByIndex(target: Flex, index: number): Promise<void> {
        const loc = this.toLocator(target);
        await loc.selectOption({ index });
    }
       
} 