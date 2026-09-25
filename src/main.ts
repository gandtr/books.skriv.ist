import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
const target = document.getElementById('app')!;
// Drop the static crawler intro from index.html; mount() appends, not replaces.
target.replaceChildren();
mount(App, { target });
