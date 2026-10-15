import {createContext,useContext} from 'react';
export const D1Auth=createContext(null);
export const useAuth=()=>useContext(D1Auth);
