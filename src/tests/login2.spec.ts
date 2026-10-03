import {expect, test} from '@playwright/test';
import { LoginPage } from '@pages/LoginPage';
import { createLogger } from '@utils/logger';
const log=createLogger('login.spec');
test.describe('logiing test case for ttacart',()=>{
    let loginpage2:LoginPage;
test.beforeEach('loging as standar user @p0',async({page})=>{
     loginpage2=new LoginPage(page);
    test.step('open tta cartpage',async()=>{
        log.info("opening TTAlogin page");
await loginpage2.open();
    });
    
});

test('logging with valid credentials @P0',async({page})=>{
    test.step('login as a standard user',async()=>{
    log.info('logging as a standard user');
await loginpage2.loginAs('standard_user','tta-secret');
})

test.step('verify login buton is no longer visible',async()=>{
    log.info("rer");
   await expect(page.locator('[data-test="login-button"]')).toBeHidden();
})
})


});