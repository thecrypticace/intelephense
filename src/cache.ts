/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

export interface Cache {
    read(key:string):Promise<any>;
    write(key:string, data:any);
    delete(key:string);
}

export class FileCache implements Cache {




}