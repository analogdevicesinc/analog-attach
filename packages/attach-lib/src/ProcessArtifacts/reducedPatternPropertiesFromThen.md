```
- if:
      properties:
        compatible:
          contains:
            enum:
              - adi,ad4697
              - adi,ad4698
    then:
      properties:

        in9-supply: false

        in11-supply: false

        in13-supply: false

        in15-supply: false

        channel@0:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@1:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@2:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@3:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@4:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@5:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@6:
          properties:
            reg:
              maximum: 7
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@7:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]

        channel@8: false

        channel@9: false

        channel@a: false

        channel@b: false

        channel@c: false

        channel@d: false

        channel@e: false

        channel@f: false
```
