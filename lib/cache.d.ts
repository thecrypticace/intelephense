export interface Cache {
    read(key: string): Promise<any>;
    write(key: string, data: any): Promise<void>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
}
export declare function createCache(path: string): FileCache;
export declare class MemoryCache implements Cache {
    private _map;
    constructor();
    read(key: string): Promise<any>;
    write(key: string, data: any): Promise<void>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
}
export declare class FileCache implements Cache {
    private path;
    constructor(path: string);
    read(key: string): Promise<any>;
    write(key: string, data: any): Promise<void>;
    delete(key: string): Promise<void>;
    flush(): Promise<void>;
    private _filePath(key);
}
