import React from "react";
import { pillClass } from "../util.js";

export default function Pill({ status }) {
  if (status == null || status === "") return null;
  return <span className={`pill ${pillClass(status)}`}>{status}</span>;
}
