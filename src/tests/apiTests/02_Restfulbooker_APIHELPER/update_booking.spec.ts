import {test,expect} from "@playwright/test";
import { ApiHelper } from "@utils/ApiHelper";
test.describe('',()=>{
test('',async({request})=>{
const api=new ApiHelper(request);
// token
const authres=await api.post("/auth",{username:'pawan', passwor:'password123'})

const {token}=await api.parseJsonResponse<{token:string}>(authres);


//2.create something to update 

const created=await api.post('/booking', {firstname: 'Pramod',
        lastname: 'Dutta',
        totalprice: 111,
        depositpaid: true,
        bookingdates: {
            checkin: '2018-01-01',
            checkout: '2019-01-01',
        },
        additionalneeds: 'Breakfast',});


    const {bookingid}=await api.parseJsonResponse<{bookingid:number}>(created);

    //3 PUT with the cookie header

    const response= await api.put('/booking/${bookingid}',
         {
                firstname: 'After',
                lastname: 'Helper',
                totalprice: 880,
                depositpaid: true,
                bookingdates: { checkin: '2026-05-02', checkout: '2026-05-09' },
                additionalneeds: 'Extra bed',
            },
            { headers: { Cookie:`token=${token}` }},
        );


        expect(api.isSuccess(response)).toBe(true);
        const updated=await api.parseJsonResponse<{firstname:string,totalprice:number}>(response);

        expect(updated.firstname).toBe('after');
        expect(updated.totalprice).toBe(880);
    


        
    
    

});
});