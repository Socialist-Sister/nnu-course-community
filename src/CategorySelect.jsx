import {Children,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CaretDown,Check} from '@phosphor-icons/react';
import './category-select.css';

// Exact trigger width, rounded shell, independent scrolling and native form validity.
export function CategorySelect({label,value,onChange,children,title,disabled=false,required=false,name}){
  const id=useId(),trigger=useRef(null),menu=useRef(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState(null),[invalid,setInvalid]=useState(false);
  const sections=useMemo(()=>Children.toArray(children).map(node=>node.type==='optgroup'
    ?{label:node.props.label,disabled:node.props.disabled,options:Children.toArray(node.props.children)}
    :{label:null,options:[node]}).map(section=>({...section,options:section.options.map(option=>({value:String(option.props.value??''),text:Children.toArray(option.props.children).join(''),hidden:option.props.hidden,disabled:section.disabled||option.props.disabled}))})),[children]);
  const allOptions=sections.flatMap(s=>s.options),options=allOptions.filter(o=>!o.hidden),selected=allOptions.find(o=>o.value===String(value??''));
  const enabled=options.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0),selectedIndex=options.findIndex(o=>o.value===String(value??'')&&!o.disabled);
  function show(){if(trigger.current?.matches(':disabled'))return;setActive(selectedIndex>=0?selectedIndex:enabled[0]??0);setOpen(true);}
  function choose(index){const option=options[index];if(!option||option.disabled||trigger.current?.matches(':disabled'))return;setOpen(false);setInvalid(false);onChange(option.value);trigger.current?.focus();}
  useEffect(()=>{if(disabled)setOpen(false);if(value!==''&&value!=null)setInvalid(false);},[disabled,value]);
  useLayoutEffect(()=>{
    if(!open)return;
    function place(){
      const box=trigger.current.getBoundingClientRect(),gap=6,edge=8;
      const below=window.innerHeight-box.bottom-gap-edge,above=box.top-gap-edge,upwards=below<200&&above>below;
      setPosition({width:box.width,left:box.left,maxHeight:Math.max(40,Math.min(400,upwards?above:below)),...(upwards?{top:'auto',bottom:window.innerHeight-box.top+gap}:{top:box.bottom+gap,bottom:'auto'})});
    }
    place();const observer=new ResizeObserver(place);observer.observe(trigger.current);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useLayoutEffect(()=>{if(open&&position&&menu.current?.showPopover&&!menu.current.matches(':popover-open'))menu.current.showPopover();},[open,!!position]);
  useEffect(()=>{
    if(!open)return;
    const dismiss=e=>{if(!trigger.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false);};
    document.addEventListener('pointerdown',dismiss);
    return()=>document.removeEventListener('pointerdown',dismiss);
  },[open]);
  useEffect(()=>{if(open&&position)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'});},[open,active,!!position,id]);
  function keyDown(e){
    if(e.key==='Escape'){if(open){e.preventDefault();e.stopPropagation();setOpen(false);}return;}
    if(e.key==='Tab'){setOpen(false);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();
      if(!open){show();if(e.key==='Home')setActive(enabled[0]??0);if(e.key==='End')setActive(enabled.at(-1)??0);}
      else setActive(i=>{const at=enabled.indexOf(i);return e.key==='Home'?enabled[0]:e.key==='End'?enabled.at(-1):enabled[Math.max(0,Math.min(enabled.length-1,at+(e.key==='ArrowDown'?1:-1)))]??0;});
    }else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(active);else show();}
  }
  let index=0;
  return <span className="select-wrap wrapping-select"><button ref={trigger} type="button" className="category-select-trigger" disabled={disabled} role="combobox" aria-label={label} aria-required={required||undefined} aria-invalid={invalid||undefined} aria-describedby={invalid?`${id}-error`:undefined} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${id}-menu`:undefined} aria-activedescendant={open&&options[active]?`${id}-${active}`:undefined} title={title||selected?.text||label} onKeyDown={keyDown} onBlur={()=>setOpen(false)} onClick={()=>open?setOpen(false):show()}><span>{selected?.text||label}</span><CaretDown size={15} aria-hidden="true"/></button>
    <select className="dropdown-validity" tabIndex={-1} aria-hidden="true" name={name} required={required} disabled={disabled} value={value??''} onChange={e=>onChange(e.target.value)} onInvalid={e=>{e.preventDefault();setInvalid(true);trigger.current?.focus();}}>{children}</select>
    {invalid&&<span id={`${id}-error`} className="dropdown-error" role="alert">请选择{label}</span>}
    {open&&position&&createPortal(<div ref={menu} id={`${id}-menu`} popover="manual" role="listbox" aria-label={label} className="category-select-menu" style={position} onMouseDown={e=>e.preventDefault()}><div className="category-select-scroll">{sections.map((section,sectionIndex)=><div key={section.label||sectionIndex} role={section.label?'group':undefined} aria-labelledby={section.label?`${id}-group-${sectionIndex}`:undefined}>{section.label&&<div className="category-select-heading" id={`${id}-group-${sectionIndex}`}>{section.label}</div>}{section.options.filter(o=>!o.hidden).map(option=>{const optionIndex=index++;return <div key={option.value} id={`${id}-${optionIndex}`} role="option" aria-selected={option.value===String(value??'')} aria-disabled={option.disabled||undefined} className={`category-select-option${active===optionIndex?' is-active':''}`} onClick={()=>choose(optionIndex)}><span>{option.text}</span>{option.value===String(value??'')&&<Check size={15} aria-hidden="true"/>}</div>;})}</div>)}</div></div>,trigger.current?.closest('dialog')||document.body)}
  </span>;
}

// Native-like adapter keeps existing form change handlers intact.
export function Dropdown({onChange,...props}){
  return <CategorySelect {...props} label={props['aria-label']||props.label||'选项'} onChange={value=>onChange?.({target:{value}})}/>;
}
