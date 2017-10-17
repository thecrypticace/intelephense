/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Predicate} from './types';


export class ReferenceTable {

}

export class ReferenceStore {


    getReferenceTable(uri:string) {

    }

    add(table:ReferenceTable) {

    }

    remove(uri:string, purge?:boolean) {

    }

    close(uri:string) {

    }

    find(name:string, filter?: Predicate<Reference>):Promise<Reference[]> {

    }

}