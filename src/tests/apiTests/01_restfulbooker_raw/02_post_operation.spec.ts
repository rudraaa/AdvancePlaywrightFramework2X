import {test,expect} from "@playwright/test";
//import{createLogger} from "@utils/logger";
import { logger } from '@utils/logger';
test('TC#1 @p0 - POST : Verify that create booking is working fine.',async({request})=>{
    //baseurl
const baseUrl=process.env.API_BASEURL||'https://restful-booker.herokuapp.com';
//payload
const payload= {
        firstname: 'Jim',
        lastname: 'Brown',
        totalprice: 111,
        depositpaid: true,
        bookingdates: {
            checkin: '2018-01-01',
            checkout: '2019-01-01',
        },
        additionalneeds: 'Breakfast',
    }; 

    //headers
    const headers={
        Accept:'application/json',
        'Content-type':'application/json'
    };

    //responseData
   const responseData= await request.post(`${baseUrl}/booking`,{
        headers,
        data:payload,
    })

    expect(responseData.status()).toBe(200);
    const data=await responseData.json();
    //console.log(data);
   expect(data.bookingid).toBeTruthy();
   expect(data.booking.firstname).toBe(payload.firstname);
   logger.info(`created booking id,${data.bookingid}`);
});