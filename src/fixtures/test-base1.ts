import { LoginPage } from "@pages/LoginPage";
import { InventoryPage } from "@pages/InventoryPage";
import { CartPage } from "@pages/CartPage";
import { CheckoutCompletePage } from "@pages/CheckoutCompletePage";
import { CheckoutStepOnePage } from "@pages/CheckoutStepOnePage";
import { CheckoutStepTwoPage } from "@pages/CheckoutStepTwoPage";
import {logintestdata} from "@testdata/logintestdata.json";
import {test as base} from "@playwright/test";

type LoginRecord={
    username:string,
    password:string
}

const user=loginTestData as LoginRecord[];

const validuser=user.find(({username})=>username==='standard_user')
const Invaliduser=user.find(({username})=>username==='locked_out_user');
const SELECTED_ITEM_ID = 'test-allthethings-tshirt-red';


export type InvalidLoginState={
    loginpage:LoginPage,
    username:string
}

export type validLoginState=
{
    loginpage:LoginPage,
    username:string
}

export type SelectedItemState={
    invetorypage:InventoryPage
    itemId:string
}

export type TestFixture={
 loginPage: LoginPage;
    inventoryPage: InventoryPage;
    itemDetailPage: ItemDetailPage;
    cartPage: CartPage;
    checkoutStepOnePage: CheckoutStepOnePage;
    checkoutStepTwoPage: CheckoutStepTwoPage;
    checkoutCompletePage: CheckoutCompletePage;

    // Ready-to-use application states
    invalidLogin: InvalidLoginState;
    validLogin: LoginPage;
    loginWithInventory: InventoryPage;
    loginWithSelectedItem: SelectedItemState;
}