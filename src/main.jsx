import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import {AccountPage} from './Account.jsx';
import {AdminPage} from './Admin.jsx';
import {AuthPage} from './Auth.jsx';
import {PolicyPage} from './Policy.jsx';
import {FirstVisitAbout} from './SiteHeader.jsx';
import "./styles.css";
import "./theme.css";
import "./review-layout.css";
import "./reviews.css";
import "./home.css";
import "./sidebar.css";
import "./community.css";
import "./auth.css";
import "./brand.css";
import "./focus.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FirstVisitAbout/>
    {['/privacy','/terms','/contact'].includes(location.pathname)?<PolicyPage page={location.pathname.slice(1)}/>:['/login','/register','/forgot-password'].includes(location.pathname)?<AuthPage mode={location.pathname.slice(1)}/>:location.pathname==='/account'?<AccountPage/>:location.pathname==='/admin'?<AdminPage/>:<App/>}
  </React.StrictMode>,
);
