import { createContext, useContext } from "react";

// Shared state and actions (filters, validation results, lookups, write/confirm, dialogs). Provided by App.
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
