import{Page,APIRequestContext, APIResponse} from '@playwright/test';
export type ApiContext=Page|APIRequestContext;
export type httpmethod='GET'|'POST'|'PUT'|'DELETE'|'PATCH';

export interface ApiRequestOptions
{url:string;
    method:httpmethod;
    headers?:Record<string,string>;
    data?:unknown;
    params?:Record<string,string>;
    timeout?:number;
}

export interface RetryOptions
{
    condition:(response:APIResponse)=>Promise<boolean>|boolean;
    pollingInterval?:number;
    reteyCount?:number;
    
}

export class ApiHelper{
    private context:ApiContext;
    constructor(context:ApiContext)
    {
        this.context=context;
    }

    private getRequest():APIRequestContext
    {
        if('request' in this.context)
        {
            return this.context.request;
        }
        return this.context;
    }
    private buildUrl(url:string, params:Record<string,string>):string{
        if(!params) return url;

       const searchparams= new URLSearchParams(params);
       return `${url}?${searchparams.toString()}`;
    }


    async callApi(options:ApiRequestOptions):Promise<APIResponse>
    {
        const{url,method,headers,params,data,timeout}=options;
       const fullurl= this.buildUrl(url,params);
       const request=this.getRequest();

       //request.get(fullurl,)
       switch(method)
       {
        case 'GET':
            return await request.get(fullurl,{headers,timeout});

            case 'POST':
               return await request.post(fullurl,{headers,data,timeout});
                case 'PUT':
                   return await request.put(fullurl,{data,timeout,headers});
                   case 'PATCH':
                   return await request.patch(fullurl,{headers,data,timeout});
                   case 'DELETE':
                    return await request.delete(fullurl,{headers,timeout});
                    default:
                        throw new Error(`Unsupported Http method: ${String(method)}`);
       }
    }


     async callApiWithRetry(
        options: ApiRequestOptions,
        retryOptions: RetryOptions,
    ): Promise<APIResponse> {
        const { condition, pollingInterval = 5000, retryCount = 3 } = retryOptions;
        let lastResponse: APIResponse | null = null;

        for (let attempt = 1; attempt <= retryCount; attempt++) {
            lastResponse = await this.callApi(options);

            if (await condition(lastResponse)) {
                return lastResponse;
            }

            if (attempt < retryCount) {
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }
        }

        return lastResponse!;
    }

    async get(url:string,data?:unknown,options?:Omit<ApiRequestOptions,'url'|'method'>):Promise<APIResponse>
    {
        return this.callApi({url,method:'GET',...options});
    }

    async post(url:string, data?:unknown,options?:Omit<ApiRequestOptions,'url'|'method'>):Promise<APIResponse>
    {
        return this.callApi({url,method:'POST',data,...options})
        
    }


     async put(url:string, data?:unknown,options?:Omit<ApiRequestOptions,'url'|'method'>):Promise<APIResponse>
    {
        return this.callApi({url,method:'PUT',data,...options})
        
    }

    
     async patch(url:string, data?:unknown,options?:Omit<ApiRequestOptions,'url'|'method'>):Promise<APIResponse>
    {
        return this.callApi({url,method:'PATCH',data,...options})
        
    }

    
     async delete(url:string, data?:unknown,options?:Omit<ApiRequestOptions,'url'|'method'>):Promise<APIResponse>
    {
        return this.callApi({url,method:'DELETE',...options}); 
        
    }
    
    isSuccess(response:APIResponse):boolean
    {
        const status=response.status();
        return status>=200 && status < 300;
    }

     isFailureClient(response: APIResponse): boolean {
        const status = response.status();
        return status >= 400 && status < 500;
    }

    async parseJsonResponse<T>(response:APIResponse):Promise<T>
    {
        return await response.json() as T;
    }

    


}