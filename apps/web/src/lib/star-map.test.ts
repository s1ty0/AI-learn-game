import { describe, expect, it } from "vitest";
import type { GraphPayload } from "./api";
import { addDiscoveries, addRelation, graphDifference, visibleGraph, type Discoveries, type DiscoveryRelation, type PersonalEdge } from "./star-map";

const graph: GraphPayload = { nodes: [
  { id:"known", type:"knowledge",position:{x:0,y:0},data:{label:"已知",subtitle:"我的原文",category:"custom",note:"保留自己的解释"}},
  { id:"hidden", type:"knowledge",position:{x:0,y:200},data:{label:"旧图暂不展示",subtitle:"旧记录",category:"custom",note:"不能丢失"}},
], edges:[{id:"legacy",source:"known",target:"hidden",label:"旧关系"}] };
const discoveries: Discoveries = { release_id:"current",status:"draft",mastery:"unverified",chapters:[{id:"first",title:"第一片"}],entities:[
  {id:"known",name:"规范名称",chapters:["first"],origins:[]},
  {id:"new",name:"新发现",chapters:["first"],origins:[{node_id:"island",title:"岛",chapter:"first",release_id:"old-pinned",completed_at:null,hint_used:true}]},
], relations:[] };
const relation: DiscoveryRelation = {id:"r1",source:"known",target:"new",statement:"用来比较",conditions:"固定条件",review_status:"proposed",source_ids:["s1"],release_id:"current"};

describe("游戏星图与共享图的保留边界",()=>{
  it("局部只展示已发现点，隐藏旧点和关系仍留在完整图",()=>{
    const result=visibleGraph(graph,discoveries,"first");
    expect(result.nodes.map(n=>n.id)).toEqual(["known"]);expect(result.edges).toEqual([]);
    expect(graph.nodes[1].data.note).toBe("不能丢失");expect(graph.edges).toHaveLength(1);
  });
  it("接入只补缺失，不改已有文字、布局或边，重复接入不增加节点",()=>{
    const next=addDiscoveries(graph,discoveries.entities);
    expect(next.nodes[0]).toEqual(graph.nodes[0]);expect(next.nodes[1]).toEqual(graph.nodes[1]);expect(next.edges).toEqual(graph.edges);
    expect(next.nodes[2].data.note).toBe("");expect(next.nodes[2].data.discovery_origins).toEqual([{node_id:"island",release_id:"old-pinned"}]);
    expect(addDiscoveries(next,discoveries.entities)).toEqual(next);
  });
  it("建议需两个端点，保留草稿来源，不覆盖玩家同方向关系",()=>{
    expect(addRelation(graph,relation)).toBe(graph);
    const imported=addDiscoveries(graph,discoveries.entities), next=addRelation(imported,relation);
    expect((next.edges.at(-1) as PersonalEdge).reference_release).toBe("current");
    expect(addRelation(next,relation)).toBe(next);
    const collision={...imported,edges:[...imported.edges,{id:"suggested:r1",source:"hidden",target:"known",label:"保留原关系"}]};
    expect(addRelation(collision,relation).edges.map(e=>e.id)).toEqual(["legacy","suggested:r1","suggested:r1:1"]);
    const full={...imported,edges:Array.from({length:500},(_,i)=>({id:`e${i}`,source:"hidden",target:"known",label:"保留"}))};
    expect(addRelation(full,relation)).toBe(full);
  });
  it("差异区分解释、位置、连接，并忽略仅字段补默认值的变化",()=>{
    const next=structuredClone(graph);
    next.nodes[0].data.note="新的解释";next.nodes[0].position.x=100;
    (next.edges[0] as PersonalEdge).note="关系的成立条件";
    expect(graphDifference(graph,next).map(item=>item.kind)).toEqual(["修改理解","移动位置","修改关系"]);
    expect(graphDifference(graph,next)[0].before).toContain("保留自己的解释");
    expect(graphDifference(graph,next)[0].after).toContain("新的解释");
    const defaults=structuredClone(graph);(defaults.edges[0] as PersonalEdge).note="";
    expect(graphDifference(graph,defaults)).toEqual([]);
  });
});
