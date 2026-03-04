实现模型搜索功能：

点击添加模型，会弹出模型搜索弹框，现在要求实现以下2种输入：

1、modelscope地址，用户输入例如https://www.modelscope.cn/models/unsloth/Qwen3.5-122B-A10B-GGUF/xxx的地址，会自动分析https://www.modelscope.cn/models/unsloth/Qwen3.5-122B-A10B-GGUF/files 这个地址，然后提取其中重要的数据（现在已经有通过modelscope提取配置文件的功能，叫add model之类的名字，但是是后台用的，用户不可用，你可以参考部分实现），如果仓里面有文件夹，应该可以看到例如https://www.modelscope.cn/models/unsloth/Qwen3.5-122B-A10B-GGUF/tree/master/IQ4\_XS的地址，这个是量化模型（多个）的地址，如果有mmproj，这个是多模态投影文件，你需要组合这些文件，形成最终可以被我们模型管理接受并且被llamacpp运行的配置文件



2、在搜索框输入非地址，而是模型名字模糊查找，例如QWEN3.5，此时会自动发送搜索请求，

请求 URL

https://www.modelscope.cn/api/v1/dolphin/agg/suggestv2

请求方法

POST

格式如下：



请求体如下：

{Query: "qwen3.5 gguf"}（由于我们系统只能运行gguf，你需要加上gguf后缀）



响应如下：

{

&nbsp;   "Code": 200,

&nbsp;   "Data": {

&nbsp;       "Dataset": {

&nbsp;           "Suggests": \[],

&nbsp;           "TotalCount": 0

&nbsp;       },

&nbsp;       "Model": {

&nbsp;           "Suggests": \[

&nbsp;               {

&nbsp;                   "ChineseName": "",

&nbsp;                   "Id": 669732,

&nbsp;                   "Name": "Qwen3.5-27B-GGUF",

&nbsp;                   "Path": "unsloth"

&nbsp;               },

&nbsp;               {

&nbsp;                   "ChineseName": "",

&nbsp;                   "Id": 669730,

&nbsp;                   "Name": "Qwen3.5-35B-A3B-GGUF",

&nbsp;                   "Path": "unsloth"

&nbsp;               },

&nbsp;               {

&nbsp;                   "ChineseName": "",

&nbsp;                   "Id": 620027,

&nbsp;                   "Name": "Qwen3-14B-Claude-4.5-Opus-High-Reasoning-Distill-GGUF",

&nbsp;                   "Path": "TeichAI"

&nbsp;               },

&nbsp;               {

&nbsp;                   "ChineseName": "",

&nbsp;                   "Id": 676985,

&nbsp;                   "Name": "Qwen3.5-9B-GGUF",

&nbsp;                   "Path": "unsloth"

&nbsp;               }

&nbsp;           ],

&nbsp;           "TotalCount": 129

&nbsp;       },

&nbsp;       "Organization": {

&nbsp;           "Suggests": \[],

&nbsp;           "TotalCount": 0

&nbsp;       },

&nbsp;       "Studio": {

&nbsp;           "Suggests": \[],

&nbsp;           "TotalCount": 0

&nbsp;       },

&nbsp;       "User": {

&nbsp;           "Suggests": \[],

&nbsp;           "TotalCount": 0

&nbsp;       }

&nbsp;   },

&nbsp;   "Message": "success",

&nbsp;   "RequestId": "93c35247-f847-4f28-915a-68f79f20f775",

&nbsp;   "Success": true

}



分析json，在ui上反映出可以点击的模型列表，用户点击后

拼接https://www.modelscope.cn/models/{Path}/{Name}

然后按照方法1种的操作，分析模型量化格式



3、当用户点击确认添加，则真正地添加这个配置文件，形成用户的模型卡片

