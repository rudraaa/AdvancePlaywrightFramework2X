import {test as base,expect} from '@playwright/test';
import { LoginPage } from '@pages/LoginPage';
import { InventoryPage } from '@pages/InventoryPage';
import { CartPage } from '@pages/CartPage';
import { CheckoutCompletePage } from '@pages/CheckoutCompletePage';
import { CheckoutStepOnePage } from '@pages/CheckoutStepOnePage';   
import { CheckoutStepTwoPage } from '@pages/CheckoutStepTwoPage';
import { ItemDetailPage } from '@pages/ItemDetailPage';
import {logintestdata} from '@testdata/logintestdata.json';

export type loginrecord={
    username:string
    password:string
}

const user=logintestdata as loginrecord[];

const validUser=user.find(({user1})=>user1.username==='standard_user');
const invalidUser=user.find(({user1})=>user1.username==='locked_out_user');

export type invalidloginstate=
{
    username:string;
    loginpage:LoginPage;
}
export type SelectedItemState=
{
   inventoryPage: InventoryPage;
   itemId:string;
}

const SELECTED_ITEM_ID = 'test-allthethings-tshirt-red';

if (!validUser || !invalidUser) {
    throw new Error('Required standard_user and locked_out_user test data is missing');
}

export type TypeFixture={
    loginPage:LoginPage;
    inventoryPage:InventoryPage;
    cartPage:CartPage;
    itemdetailsPage:ItemDetailPage;
    checkoutStepOnePage: CheckoutStepOnePage;
    checkoutStepTwoPage: CheckoutStepTwoPage;
    checkoutCompletePage: CheckoutCompletePage;
    //state defination
    invalidLogin:invalidloginstate;
    validLogin:LoginPage;
    loginwithInventory:InventoryPage;
    loginwithSelectedItem:SelectedItemState;
};

export const test=base.extend<TypeFixture>(
    {
loginPage:async({page},use)=>{
    await use(new LoginPage(page));
},
inventoryPage:async({page},use)=>{
    await use(new InventoryPage(page));
},
cartPage:async({page},use)=>{
    await use(new CartPage(page));
},
 itemdetailsPage: async({page},use)=>{
    await use(new ItemDetailPage(page));
},

checkoutStepOnePage:async({page},use)=>{
    await use(new CheckoutStepOnePage(page));
},
checkoutStepTwoPage:async({page},use)=>{
    await use(new CheckoutStepTwoPage(page));
},

checkoutCompletePage:async({page},use)=>{
    await use(new CheckoutCompletePage(page));
},

invalidLogin:async({page,loginPage},use)=>{
    loginPage.open();
    loginPage.loginAs(invalidUser.username,invalidUser.password)
    await expect(page.locator('[data-test="error"]')).toBevisible();
    await use(loginPage,username:invalidUser.username);
},

validLogin:async({loginPage},use)=>{
    loginPage.open();
    loginPage.loginAs(validUser.username,validUser.password);
    loginPage.waitForLoginButtonHidden();
    await use(loginPage);
},
loginwithInventory:async({validLogin,inventoryPage},use)=>{
    void validLogin;
    inventoryPage.assertLoaded();
    await use(inventoryPage);

},
loginwithSelectedItem:async({loginwithInventory},use)=>{
    loginwithInventory.addToCart(SELECTED_ITEM_ID);
    await use(inventoryPage:loginwithInventory,
        itemId:SELECTED_ITEM_ID);
},

});
    export {expect};
//);

